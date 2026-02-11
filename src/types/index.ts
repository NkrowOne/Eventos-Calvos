import {
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  PermissionsBitField,
} from 'discord.js';

export type CommandInteraction = ChatInputCommandInteraction;
export type { ButtonInteraction, StringSelectMenuInteraction };

export interface CommandHandler {
  data: any;
  execute: (interaction: CommandInteraction) => Promise<void>;
}

export interface ButtonHandler {
  customId: string | RegExp;
  execute: (interaction: ButtonInteraction) => Promise<void>;
}

export interface SelectMenuHandler {
  customId: string | RegExp;
  execute: (interaction: StringSelectMenuInteraction) => Promise<void>;
}

export const CUSTOM_IDS = {
  REGISTER_BUTTON: 'event_register',
  VOTE_GROUP_PREFIX: 'vote_group_',
  VOTE_FINAL_PREFIX: 'vote_final_',
  VOTE_INVITER_PREFIX: 'vote_inviter_',
  CONFIRM_REGISTER: 'confirm_register',
} as const;

export const COLORS = {
  PRIMARY: 0x5865F2,    // Discord blurple
  SUCCESS: 0x57F287,    // Verde
  WARNING: 0xFEE75C,    // Amarillo
  DANGER: 0xED4245,     // Rojo
  INFO: 0x5865F2,       // Azul
  GOLD: 0xF1C40F,       // Dorado (ganador)
  SILVER: 0xC0C0C0,     // Plata (segundo)
} as const;

export const EMOJIS = {
  TROPHY: '🏆',
  MEDAL: '🥈',
  STAR: '⭐',
  VOTE: '🗳️',
  CHECK: '✅',
  CROSS: '❌',
  WARNING: '⚠️',
  CROWN: '👑',
  FIRE: '🔥',
  LINK: '🔗',
  PERSON: '👤',
  CLOCK: '⏰',
  GIFT: '🎁',
  CALENDAR: '📅',
  GLOBE: '🌐',
} as const;

export const LIMITS = {
  MAX_WARNINGS: 3,
  WARNING_GRACE_HOURS: 24,
  INVITE_VALIDATION_HOURS: 24,
  FINAL_VOTE_HOURS: 24,
  GROUP_SIZE: 10,
  ADVANCE_PER_GROUP: 3,
} as const;
