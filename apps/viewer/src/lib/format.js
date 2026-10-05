export const fmtDate = (d) => (d ? new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d)) : 'TBC');
export const fmtTime = (d) => (d ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(d)) : '');
export const fmtDateTime = (d) => (d ? `${fmtDate(d)} · ${fmtTime(d)}` : 'Date TBC');
export const dayKey = (d) => (d ? new Date(d).toDateString() : 'TBC');
export const num = (v, digits = 2) => (v === null || v === undefined ? '-' : Number(v).toFixed(digits));

export const STAGE_LABEL = {
  league: 'League', qualifier: 'Qualifier', eliminator: 'Eliminator', quarter_final: 'Quarter-final', semi_final: 'Semi-final', final: 'Final',
};

export const IN_PLAY = ['LIVE', 'INNINGS_BREAK', 'SECOND_INNINGS'];
export const isLive = (status) => IN_PLAY.includes(status);
