// SPDX-License-Identifier: AGPL-3.0-only

import { z } from 'zod';

import {
  Argument,
  EDegree,
  EFuncType,
  Orientation,
  SecType,
  TrackStyle,
} from '../../model/enums.js';

// Shared primitive schemas.
const finiteNumber = z.number().refine((n) => Number.isFinite(n), {
  message: 'Number must be finite (no NaN or Infinity).',
});

const vec3 = z.tuple([finiteNumber, finiteNumber, finiteNumber]);
const vec2 = z.tuple([finiteNumber, finiteNumber]);

// Enum schemas use nativeEnum so the wire format carries the numeric FVD++
// value — matches spec §4.1 ("preserve numeric values for .fvd compat").
const eDegreeSchema = z.nativeEnum(EDegree);
const eFuncTypeSchema = z.nativeEnum(EFuncType);
const trackStyleSchema = z.nativeEnum(TrackStyle);
const orientationSchema = z.nativeEnum(Orientation);
const argumentSchema = z.nativeEnum(Argument);

// SubFunc: flat shape matching model/subfunction.ts. `pointList` is only
// permitted when degree === Freeform and is required in that case.
export const subFuncSchema = z
  .object({
    degree: eDegreeSchema,
    length: finiteNumber.nonnegative(),
    startValue: finiteNumber,
    endValue: finiteNumber,
    arg1: finiteNumber,
    centerArg: finiteNumber,
    tensionArg: finiteNumber,
    pointList: z.tuple([vec2, vec2]).optional(),
  })
  .superRefine((val, ctx) => {
    const isFreeform = val.degree === EDegree.Freeform;
    if (isFreeform && val.pointList === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Freeform subfunctions require pointList.',
        path: ['pointList'],
      });
    }
    if (!isFreeform && val.pointList !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pointList is only valid for Freeform subfunctions.',
        path: ['pointList'],
      });
    }
  });

export const funcSchema = z.object({
  kind: eFuncTypeSchema,
  name: z.string(),
  locked: z.boolean(),
  subfuncs: z.array(subFuncSchema),
});

// Section variants. Using z.discriminatedUnion on the numeric `type` field
// gives Zod O(1) dispatch and keeps error paths precise.
const anchorSchema = z.object({
  type: z.literal(SecType.Anchor),
  name: z.string(),
  position: vec3,
  pitch: finiteNumber,
  yaw: finiteNumber,
  roll: finiteNumber,
  speed: finiteNumber,
});

const straightSchema = z.object({
  type: z.literal(SecType.Straight),
  name: z.string(),
  length: finiteNumber.nonnegative(),
  rollFunc: funcSchema,
});

const curvedSchema = z.object({
  type: z.literal(SecType.Curved),
  name: z.string(),
  length: finiteNumber.nonnegative(),
  pitchRate: finiteNumber,
  yawRate: finiteNumber,
  leadIn: finiteNumber.nonnegative(),
  leadOut: finiteNumber.nonnegative(),
  rollFunc: funcSchema,
});

const forcedSchema = z.object({
  type: z.literal(SecType.Forced),
  name: z.string(),
  argument: argumentSchema,
  orientation: orientationSchema,
  extent: finiteNumber.nonnegative(),
  rollFunc: funcSchema,
  normalFunc: funcSchema,
  lateralFunc: funcSchema,
});

const geometricSchema = z.object({
  type: z.literal(SecType.Geometric),
  name: z.string(),
  argument: argumentSchema,
  extent: finiteNumber.nonnegative(),
  rollFunc: funcSchema,
  pitchFunc: funcSchema,
  yawFunc: funcSchema,
});

const bezierSchema = z.object({
  type: z.literal(SecType.Bezier),
  name: z.string(),
  controlPoints: z.tuple([vec3, vec3, vec3, vec3]),
  rollFunc: funcSchema,
  smoothStart: z.boolean(),
  smoothEnd: z.boolean(),
});

const noLimitsCsvSchema = z.object({
  type: z.literal(SecType.NoLimitsCSV),
  name: z.string(),
  csvRef: z.string(),
});

export const sectionSchema = z.discriminatedUnion('type', [
  anchorSchema,
  straightSchema,
  curvedSchema,
  forcedSchema,
  geometricSchema,
  bezierSchema,
  noLimitsCsvSchema,
]);

export const smootherSchema = z.object({
  fromSection: z.number().int().nonnegative(),
  toSection: z.number().int().nonnegative(),
  strength: finiteNumber.min(0).max(1),
});

export const trackSchema = z.object({
  name: z.string(),
  style: trackStyleSchema,
  heart: finiteNumber,
  friction: finiteNumber.nonnegative(),
  resistance: finiteNumber.nonnegative(),
  sections: z.array(sectionSchema),
  smoothers: z.array(smootherSchema),
});

export const projectSchema = z.object({
  texturePath: z.string(),
  tracks: z.array(trackSchema),
});

// Outer file wrapper — the first two fields identify the format and version
// ahead of any data so the reader can dispatch migrations before schema
// validation (spec §8.1).
export const webFvdFileV1Schema = z.object({
  format: z.literal('webfvd'),
  version: z.literal(1),
  project: projectSchema,
});

export type WebFvdFileV1 = z.infer<typeof webFvdFileV1Schema>;
