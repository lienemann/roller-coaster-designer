// SPDX-License-Identifier: AGPL-3.0-only

// Numeric values are the FVD++ 0.79 on-disk values. Keeping them exact means
// the legacy .fvd reader/writer (M9) can write the integer tag straight
// through without translation. New code chooses the enum by name; the numbers
// exist only for wire-format parity.

export enum SecType {
  Anchor = 0,
  Straight = 1,
  Curved = 2,
  Forced = 3,
  Geometric = 4,
  Bezier = 5,
  NoLimitsCSV = 6,
}

export enum EDegree {
  Linear = 0,
  Quadratic = 1,
  Cubic = 2,
  Quartic = 3,
  Quintic = 4,
  Sinusoidal = 5,
  Plateau = 6,
  ToZero = 7,
  Freeform = 8,
}

export enum EFuncType {
  Roll = 0,
  Normal = 1,
  Lateral = 2,
  Pitch = 3,
  Yaw = 4,
}

export enum TrackStyle {
  Generic = 0,
  GenericFlat = 1,
  Vekoma = 2,
  BM = 3,
  Triangle = 4,
  Box = 5,
  SmallFlat = 6,
  DoubleSpine = 7,
}

// FVD++ encodes these as booleans in section.h (EULER=true, QUATERNION=false;
// TIME=false, DISTANCE=true). Spec §4.1 promotes them to real enums in
// webfvd and reserves the bool mapping for the legacy .fvd writer.
export enum Orientation {
  Euler = 0,
  Quaternion = 1,
}

export enum Argument {
  Time = 0,
  Distance = 1,
}

export const SEC_TYPE_NAMES = {
  [SecType.Anchor]: 'Anchor',
  [SecType.Straight]: 'Straight',
  [SecType.Curved]: 'Curved',
  [SecType.Forced]: 'Forced',
  [SecType.Geometric]: 'Geometric',
  [SecType.Bezier]: 'Bezier',
  [SecType.NoLimitsCSV]: 'NoLimitsCSV',
} as const;

export const FUNC_TYPE_NAMES = {
  [EFuncType.Roll]: 'Roll',
  [EFuncType.Normal]: 'Normal',
  [EFuncType.Lateral]: 'Lateral',
  [EFuncType.Pitch]: 'Pitch',
  [EFuncType.Yaw]: 'Yaw',
} as const;

export const DEGREE_NAMES = {
  [EDegree.Linear]: 'Linear',
  [EDegree.Quadratic]: 'Quadratic',
  [EDegree.Cubic]: 'Cubic',
  [EDegree.Quartic]: 'Quartic',
  [EDegree.Quintic]: 'Quintic',
  [EDegree.Sinusoidal]: 'Sinusoidal',
  [EDegree.Plateau]: 'Plateau',
  [EDegree.ToZero]: 'ToZero',
  [EDegree.Freeform]: 'Freeform',
} as const;

export const TRACK_STYLE_NAMES = {
  [TrackStyle.Generic]: 'Generic',
  [TrackStyle.GenericFlat]: 'GenericFlat',
  [TrackStyle.Vekoma]: 'Vekoma',
  [TrackStyle.BM]: 'BM',
  [TrackStyle.Triangle]: 'Triangle',
  [TrackStyle.Box]: 'Box',
  [TrackStyle.SmallFlat]: 'SmallFlat',
  [TrackStyle.DoubleSpine]: 'DoubleSpine',
} as const;
