import { Events, GuildMember, PartialGuildMember } from 'discord.js';
import { getActiveEvent, getParticipant, disqualifyParticipant } from '../services/contest.js';

export const name = Events.GuildMemberRemove;

export async function execute(member: GuildMember | PartialGuildMember) {
  if (member.user?.bot) return;

  const event = await getActiveEvent(member.guild.id);
  if (!event) return;

  const participant = await getParticipant(event.id, member.id);
  if (!participant) return;

  if (participant.status !== 'DISQUALIFIED' && participant.status !== 'WITHDRAWN') {
    await disqualifyParticipant(
      participant.id,
      event.id,
      member.id,
      'Abandonó el servidor'
    );
    console.log(`[Contest] ${member.user?.tag || member.id} descalificado por abandonar el servidor`);
  }
}
