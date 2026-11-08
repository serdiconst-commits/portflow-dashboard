export const EMPTY_YARD_TYPES = ['EMPTY_YARD', 'YARD_RETURN'];
export const isEmptyYardMove = move => EMPTY_YARD_TYPES.includes(move?.moveType);
export const hasOpenEmptyYard = load => (load?.moves || []).some(move => isEmptyYardMove(move) && !['Completed', 'Cancelled'].includes(move.status));
export const emptyYardLabel = type => type === 'EMPTY_YARD' ? 'Drop Empty at Yard' : 'Empty Return to Port';
