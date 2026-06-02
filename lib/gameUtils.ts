export const getFormatFromMaxPlayers = (maxPlayers: number | undefined): string => {
  if (maxPlayers === 12) return '6v6';
  if (maxPlayers === 14) return '7v7';
  if (maxPlayers === 16) return '8v8';
  if (maxPlayers === 20) return '10v10';
  return '6v6';
};
