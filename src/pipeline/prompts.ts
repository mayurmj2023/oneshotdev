/**
 * The model is asked to respond with a strict JSON structure so we can
 * reliably parse it into files on disk. We never eval/exec model output.
 */
export const FILE_FORMAT_INSTRUCTIONS = `
Respond with ONLY a JSON object, no prose, no markdown fences. Shape:
{
  "files": [ { "path": "relative/path/to/file.ext", "content": "full file content" } ],
  "notes": "1-2 sentence summary of what you did"
}
Include every file needed to run and test the project (source + test + package manifest).
Use relative paths only. Do not include node_modules or build output.
`;

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GenerationResult {
  files: GeneratedFile[];
  notes: string;
}

export function parseGenerationResponse(raw: string): GenerationResult {
  // Strip accidental markdown fences if the model adds them anyway.
  const cleaned = raw.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Could not parse model response as JSON: ${(e as Error).message}\n---\n${raw.slice(0, 500)}`);
  }
  if (!Array.isArray(parsed.files)) {
    throw new Error('Model response missing "files" array.');
  }
  return { files: parsed.files, notes: parsed.notes ?? '' };
}

export function buildInitialPrompt(userPrompt: string): string {
  return `Build the following: ${userPrompt}

Requirements:
- Include a package.json (or equivalent manifest) with a working test script.
- Include actual tests, not just a stub.
- Code should be runnable with no manual edits.
${FILE_FORMAT_INSTRUCTIONS}`;
}

export function buildFixPrompt(userPrompt: string, previousFiles: GeneratedFile[], testOutput: string): string {
  const fileList = previousFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');
  return `You previously generated a project for this request: ${userPrompt}

Here is the current code:
${fileList}

Running the test command produced this output (it failed):
${testOutput.slice(0, 4000)}

Fix the code so the tests pass. Return the FULL updated set of files (include unchanged files too).
${FILE_FORMAT_INSTRUCTIONS}`;
}
