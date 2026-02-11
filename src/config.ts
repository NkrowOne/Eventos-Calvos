import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: required('GUILD_ID'),
  },
  database: {
    url: required('DATABASE_URL'),
  },
  nodeEnv: process.env.NODE_ENV || 'development',
} as const;
