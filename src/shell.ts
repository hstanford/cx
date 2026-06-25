export function shellJoin(argv: string[]): string {
  return argv.map(quote).join(' ');
}

function quote(token: string): string {
  if (/^[a-zA-Z0-9_\-./:=@]+$/.test(token)) return token;
  return `'${token.replace(/'/g, `'\\''`)}'`;
}
