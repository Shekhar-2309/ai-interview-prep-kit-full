function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required environment variable: ${name} — see .env.example`);
  }
  return value;
}

export const config = {
  get groqApiKey() {
    return requireEnv("GROQ_API_KEY");
  },
  get mongodbUri() {
    return requireEnv("MONGODB_URI");
  },
  get sessionSecret() {
    return requireEnv("SESSION_SECRET");
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  get port() {
    return Number(process.env.PORT ?? 4000);
  },
};
