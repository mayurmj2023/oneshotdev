import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ECRClient, CreateRepositoryCommand, DescribeRepositoriesCommand, GetAuthorizationTokenCommand } from '@aws-sdk/client-ecr';
import {
  AppRunnerClient,
  CreateServiceCommand,
  UpdateServiceCommand,
  DescribeServiceCommand,
  ListServicesCommand,
} from '@aws-sdk/client-apprunner';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

function run(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`${cmd}\n${stderr || stdout}`));
      resolve(stdout);
    });
  });
}

export interface DeployOptions {
  workspaceRoot: string;
  region: string;
  ecrRepoName: string;
  serviceName: string;
  containerPort: number;
  ecrAccessRoleArn: string;
  onProgress: (msg: string) => void;
}

function ensureDockerfile(workspaceRoot: string, port: number) {
  const dockerfilePath = path.join(workspaceRoot, 'Dockerfile');
  if (fs.existsSync(dockerfilePath)) return;
  const dockerfile = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
EXPOSE ${port}
CMD ["node", "index.js"]
`;
  fs.writeFileSync(dockerfilePath, dockerfile, 'utf8');
}

export async function deployToAppRunner(opts: DeployOptions): Promise<string> {
  const { workspaceRoot, region, ecrRepoName, serviceName, containerPort, ecrAccessRoleArn, onProgress } = opts;

  const sts = new STSClient({ region });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  const accountId = identity.Account;
  if (!accountId) throw new Error('Could not resolve AWS account ID. Check your AWS credentials.');

  onProgress(`Using AWS account ${accountId} in ${region}`);

  ensureDockerfile(workspaceRoot, containerPort);

  // 1. Ensure ECR repo exists
  const ecr = new ECRClient({ region });
  try {
    await ecr.send(new DescribeRepositoriesCommand({ repositoryNames: [ecrRepoName] }));
    onProgress(`ECR repo "${ecrRepoName}" already exists.`);
  } catch {
    await ecr.send(new CreateRepositoryCommand({ repositoryName: ecrRepoName }));
    onProgress(`Created ECR repo "${ecrRepoName}".`);
  }

  const repoUri = `${accountId}.dkr.ecr.${region}.amazonaws.com/${ecrRepoName}`;
  const imageTag = `${repoUri}:latest`;

  // 2. Docker login to ECR
  const auth = await ecr.send(new GetAuthorizationTokenCommand({}));
  const authToken = auth.authorizationData?.[0]?.authorizationToken;
  if (!authToken) throw new Error('Failed to get ECR auth token.');
  const decoded = Buffer.from(authToken, 'base64').toString('utf8');
  const password = decoded.split(':')[1];
  await run(`echo "${password}" | docker login --username AWS --password-stdin ${accountId}.dkr.ecr.${region}.amazonaws.com`, workspaceRoot);
  onProgress('Logged in to ECR.');

  // 3. Build & push image
  onProgress('Building Docker image (this can take a minute)...');
  await run(`docker build -t ${imageTag} .`, workspaceRoot);
  onProgress('Pushing image to ECR...');
  await run(`docker push ${imageTag}`, workspaceRoot);

  // 4. Create or update App Runner service
  const appRunner = new AppRunnerClient({ region });
  const list = await appRunner.send(new ListServicesCommand({}));
  const existing = list.ServiceSummaryList?.find((s) => s.ServiceName === serviceName);

  const sourceConfiguration = {
    AuthenticationConfiguration: { AccessRoleArn: ecrAccessRoleArn },
    AutoDeploymentsEnabled: false,
    ImageRepository: {
      ImageIdentifier: imageTag,
      ImageRepositoryType: 'ECR' as const,
      ImageConfiguration: { Port: String(containerPort) },
    },
  };

  if (existing?.ServiceArn) {
    onProgress(`Updating existing App Runner service "${serviceName}"...`);
    await appRunner.send(
      new UpdateServiceCommand({ ServiceArn: existing.ServiceArn, SourceConfiguration: sourceConfiguration }),
    );
    const desc = await appRunner.send(new DescribeServiceCommand({ ServiceArn: existing.ServiceArn }));
    return desc.Service?.ServiceUrl ?? '(deployed, URL pending)';
  } else {
    onProgress(`Creating App Runner service "${serviceName}"...`);
    const created = await appRunner.send(
      new CreateServiceCommand({ ServiceName: serviceName, SourceConfiguration: sourceConfiguration }),
    );
    return created.Service?.ServiceUrl ?? '(deploying, check AWS console for URL)';
  }
}
