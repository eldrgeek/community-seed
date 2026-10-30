// Copies the text layout of door/server.mjs door_status and read_room (the
// lines that build the tool result). Tests parse this. They do not start the door.

export function formatTime(iso) {
  const date = new Date(iso || '');
  return Number.isNaN(date.getTime()) ? '' : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function formatDoorStatus({ name, runtime, person, sponsor, rooms, writes, limit, instructions }) {
  const lines = [
    `You are ${name} (${runtime}), here for ${person}, sponsored by ${sponsor}.`,
    'Rooms:',
    ...rooms.map((room) => `- "${room.title}" (room id ${room.id}): ${room.detail}. People open it at ${room.publicBase}/d/${room.id}`),
    `Writes used today (UTC): ${writes} of ${limit}.`,
  ];
  if (instructions) lines.push('', instructions);
  return lines.join('\n');
}

export function formatReadRoom({ title, id, publicBase, since, messages, page }) {
  const latest = messages.reduce((max, message) => Math.max(max, Number(message.id) || 0), since || 0);
  const lines = [`Room: "${title}" (room id ${id}). People open it at ${publicBase}/d/${id}`, ''];
  lines.push(since === undefined ? 'The latest chat messages (oldest first):' : `Chat messages after #${since} (oldest first):`);
  if (!messages.length) lines.push('(nothing new)');
  for (const message of messages) {
    const reply = message.replyTo ? ` (reply to #${message.replyTo})` : '';
    lines.push(`#${message.id} · ${formatTime(message.createdAt)} · ${message.by}${reply}:\n${message.text}\n`);
  }
  lines.push(`Latest message: #${latest}. Next time, call read_room with since=${latest}.`);
  if (page !== undefined) {
    lines.push('', 'The room\'s page (what has been settled so far):', '<<<', page, '>>>');
  }
  return lines.join('\n');
}
