# OneShotDev

A VS Code extension: one prompt → AI writes code → runs your tests → fixes
failures in a loop → deploys the result to AWS, all from inside the editor.

Supports **Claude**, **OpenAI**, and **Gemini** — pick one as your active
provider (Claude is default), you supply each key you want available.

## What it actually does

1. You type one prompt describing what to build.
2. The selected AI generates a full project (code + tests + manifest) and
   writes it into your open workspace folder.
3. It runs your configured test command (default `npm test`).
4. If tests fail, the error output is fed back to the AI to fix, and it
   retries — up to `oneshotdev.maxFixAttempts` times (default 4).
5. Once tests pass, it asks if you want to deploy. If yes: builds a Docker
   image, pushes it to AWS ECR, and creates/updates an **AWS App Runner**
   service running it.

Why App Runner: it's the simplest AWS option for "deploy a container and get
a public HTTPS URL" — no load balancer, VPC, or cluster config needed (unlike
ECS/Fargate or EC2).

## Install (development mode)

```bash
npm install
npm run build
```

Then in VS Code: `Run > Start Debugging` (or press F5) from this folder —
that launches an Extension Development Host with OneShotDev loaded.

To package it properly for normal install:
```bash
npm install -g @vscode/vsce
vsce package
```
This produces a `.vsix` you can install via *Extensions → ... → Install from VSIX*.



## Configure (Settings → search "oneshotdev")

| Setting | Purpose |
|---|---|
| `oneshotdev.provider` | `claude` / `openai` / `gemini` |
| `oneshotdev.claudeApiKey` / `openaiApiKey` / `geminiApiKey` | Your keys — only the one matching `provider` is used |
| `oneshotdev.testCommand` | Defaults to `npm test` |
| `oneshotdev.maxFixAttempts` | Fix-retry loop limit |
| `oneshotdev.awsRegion` | e.g. `us-east-1` |
| `oneshotdev.ecrRepoName` / `appRunnerServiceName` | Naming for AWS resources |
| `oneshotdev.ecrAccessRoleArn` | **Required before deploying** — see below |
| `oneshotdev.containerPort` | Port your app listens on |

## One-time AWS setup (required before first deploy)

App Runner needs an IAM role that lets it pull images from your private ECR
repo. Create it once:

```bash
aws iam create-role --role-name AppRunnerECRAccessRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "build.apprunner.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy --role-name AppRunnerECRAccessRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
```

Copy the resulting Role ARN into `oneshotdev.ecrAccessRoleArn`.

You also need, on the machine running VS Code:
- **Docker** installed and running
- **AWS CLI credentials configured** (`aws configure`, or env vars, or an
  AWS SSO profile) with permissions for ECR + App Runner + STS

## Cost & safety notes

- Each generate/fix call costs you API credits on whichever provider you pick.
- App Runner bills per vCPU/memory while running — it's not serverless-free
  like Lambda. For light/dev workloads this is usually a few dollars/month,
  but keep an eye on it.
- The extension only writes files inside your open workspace folder and
  refuses any path that tries to escape it (no `../` traversal).
- Generated code is never `eval`'d — it's written to disk and run via your
  own test command, same as code you'd write yourself.


## OneShotDev — User Guide

### What it does
OneShotDev turns a single prompt into working code: it generates code and tests, runs a fix loop until tests pass, and can optionally deploy to AWS (ECR/App Runner). It supports multiple AI providers.

---

### Installation
1. Open **VS Code**.
2. Go to **Extensions** (`Ctrl+Shift+X`).
3. Search for `OneShotDev` (or install from `.vsix` — see below).
4. Click **Install**.

> 💡 **Installing from a `.vsix` file instead:** Extensions panel → `...` menu → **Install from VSIX...** → select the file.

---

### First-time setup
1. Open the **Command Palette** (`Ctrl+Shift+P`).
2. Run `OneShotDev: Configure` (or similar — adjust to your actual command ID).
3. Enter your AI provider API key (e.g., Anthropic, OpenAI — whichever providers you support).
4. *Optional:* If you plan to use AWS deployment, also provide your AWS credentials/region.

---

### Basic usage
1. Open the folder/project you want to work in.
2. Open the **Command Palette** → `OneShotDev: Generate`.
3. Type your prompt describing what you want built.
   * *Example:* `"REST API for a todo list with CRUD endpoints"`
4. OneShotDev will automatically:
   * Generate the code and tests
   * Run the tests automatically
   * **Fix Loop:** If tests fail, it enters a loop—regenerating/patching until they pass (or it hits a retry limit).
5. Review the generated files in your workspace before committing.

#### Optional: Deploying to AWS
1. Run `OneShotDev: Deploy` from the Command Palette.
2. Confirm the target (**ECR repository**, **App Runner service**).
3. OneShotDev builds, pushes the image, and deploys it.
4. Check the **Output panel** for the deployed service URL.

---

### Switching AI providers
1. Open settings (`Ctrl+,`), search for `OneShotDev`.
2. Choose your preferred provider and model from the dropdown/config field.

---

### Tips
* **Be specific:** In your prompt, mention the language, framework, and any constraints.
* **Review code:** Always review generated code before deploying to production.
* **Debugging loops:** If the fix loop fails repeatedly, check the **Output/Logs panel** for the last error — it usually points to a missing dependency or unclear spec.
