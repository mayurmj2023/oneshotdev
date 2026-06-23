export interface AIProvider {
  name: string;
  /**
   * Sends a system + user prompt, returns the raw text response.
   */
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}
