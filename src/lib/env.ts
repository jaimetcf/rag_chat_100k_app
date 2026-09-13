export function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}

export function getOptionalEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}
