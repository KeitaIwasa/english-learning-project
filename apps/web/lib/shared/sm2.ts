export type Sm2Input = {
  quality: number;
  repetition: number;
  intervalDays: number;
  easeFactor: number;
};

export function nextSm2(input: Sm2Input) {
  const quality = Math.max(0, Math.min(5, input.quality));

  if (quality < 3) {
    return {
      repetition: 0,
      intervalDays: 1,
      easeFactor: Math.max(1.3, input.easeFactor - 0.2)
    };
  }

  const repetition = input.repetition + 1;
  let intervalDays = 1;
  if (repetition === 1) {
    intervalDays = 1;
  } else if (repetition === 2) {
    intervalDays = 6;
  } else {
    intervalDays = Math.round(input.intervalDays * input.easeFactor);
  }

  const easeFactor = Math.max(
    1.3,
    input.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );

  return {
    repetition,
    intervalDays,
    easeFactor
  };
}
