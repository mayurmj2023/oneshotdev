import { AIProvider } from './provider';

export class ClaudeProvider implements AIProvider {
  name = 'claude';
  constructor(private apiKey: string, private model = 'claude-sonnet-4-6') {}

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    const block = (data.content || []).find((b: any) => b.type === 'text');
    return block?.text ?? '';
  }
}
