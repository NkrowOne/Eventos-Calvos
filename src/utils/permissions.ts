import { GuildMember, PermissionsBitField } from 'discord.js';

export function isAdmin(member: GuildMember): boolean {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

export function isModerator(member: GuildMember): boolean {
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
    member.permissions.has(PermissionsBitField.Flags.ManageMessages)
  );
}

export function isAdminOrMod(member: GuildMember): boolean {
  return isAdmin(member) || isModerator(member);
}

export function canParticipate(member: GuildMember): boolean {
  return !isAdminOrMod(member) && !member.user.bot;
}
