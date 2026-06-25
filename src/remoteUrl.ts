export function extractRemoteUrl(paneText: string): string | undefined {
  const m = paneText.match(/https?:\/\/[^\s]*claude\.ai\/[^\s]+/);
  return m ? m[0] : undefined;
}
