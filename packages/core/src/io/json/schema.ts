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

// Every section gets an optional `color` — a `#rrggbb` UI tint the app
// uses to keep rails + graph markers in sync. Pure cosmetic; no physics
// cares about it. Added to each variant rather than merged via `.and()` so
// discriminated-union narrowing stays O(1).
const colorField = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a #rrggbb hex string.')
  .optional();

// Per-section velocity-mode fields shared by Straight / Curved / Forced /
// Geometric. Defaulted on missing input so a project authored without them
// validates as if the user never opted into the held-velocity branch.
const speedFields = {
  bSpeed: z.boolean().optional(),
  fVel: finiteNumber.optional(),
};

// Section variants. Using z.discriminatedUnion on the numeric `type` field
// gives Zod O(1) dispatch and keeps error paths precise.
const anchorSchema = z.object({
  type: z.literal(SecType.Anchor),
  name: z.string(),
  color: colorField,
  position: vec3,
  pitch: finiteNumber,
  yaw: finiteNumber,
  roll: finiteNumber,
  speed: finiteNumber,
});

const straightSchema = z.object({
  type: z.literal(SecType.Straight),
  name: z.string(),
  color: colorField,
  length: finiteNumber.nonnegative(),
  rollFunc: funcSchema,
  ...speedFields,
});

const curvedSchema = z.object({
  type: z.literal(SecType.Curved),
  name: z.string(),
  color: colorField,
  orientation: orientationSchema.optional(),
  fAngle: finiteNumber.nonnegative(),
  fRadius: finiteNumber.positive(),
  fDirection: finiteNumber,
  fLeadIn: finiteNumber.nonnegative(),
  fLeadOut: finiteNumber.nonnegative(),
  rollFunc: funcSchema,
  ...speedFields,
});

const forcedSchema = z.object({
  type: z.literal(SecType.Forced),
  name: z.string(),
  color: colorField,
  argument: argumentSchema,
  orientation: orientationSchema,
  extent: finiteNumber.nonnegative(),
  rollFunc: funcSchema,
  normalFunc: funcSchema,
  lateralFunc: funcSchema,
  ...speedFields,
});

const geometricSchema = z.object({
  type: z.literal(SecType.Geometric),
  name: z.string(),
  color: colorField,
  argument: argumentSchema,
  orientation: orientationSchema,
  extent: finiteNumber.nonnegative(),
  rollFunc: funcSchema,
  pitchFunc: funcSchema,
  yawFunc: funcSchema,
  ...speedFields,
});

const bezierSegmentSchema = z.object({
  P1: vec3,
  Kp1: vec3,
  Kp2: vec3,
  contRoll: z.boolean().optional(),
  relRoll: z.boolean().optional(),
  roll: finiteNumber.optional(),
});

const bezierSchema = z.object({
  type: z.literal(SecType.Bezier),
  name: z.string(),
  color: colorField,
  segments: z.array(bezierSegmentSchema).min(2),
  rollFunc: funcSchema,
  smoothStart: z.boolean(),
  smoothEnd: z.boolean(),
  supports: z.array(vec3).optional(),
});

const noLimitsCsvNodeSchema = z.object({
  pos: vec3,
  dir: vec3,
  lat: vec3,
});

const noLimitsCsvSchema = z.object({
  type: z.literal(SecType.NoLimitsCSV),
  name: z.string(),
  color: colorField,
  csvRef: z.string(),
  nodes: z.array(noLimitsCsvNodeSchema).optional(),
});

const closureSchema = z.object({
  type: z.literal(SecType.Closure),
  name: z.string(),
  color: colorField,
  entryHandleLength: finiteNumber.nonnegative(),
  exitHandleLength: finiteNumber.nonnegative(),
  rollFunc: funcSchema,
});

export const sectionSchema = z.discriminatedUnion('type', [
  anchorSchema,
  straightSchema,
  curvedSchema,
  forcedSchema,
  geometricSchema,
  bezierSchema,
  noLimitsCsvSchema,
  closureSchema,
]);

export const smootherSchema = z.object({
  fromSection: z.number().int().nonnegative(),
  toSection: z.number().int().nonnegative(),
  strength: finiteNumber.min(0).max(1),
  fvd: z
    .object({
      name: z.string(),
      fromNode: z.number().int(),
      toNode: z.number().int(),
      length: z.number().int(),
      iterations: z.number().int(),
      active: z.boolean(),
    })
    .optional(),
});

const fvdTrackDisplaySchema = z
  .object({
    colorsHex: z.string().regex(/^[0-9a-f]*$/),
    drawTrack: z.boolean(),
    drawHeartline: z.number().int(),
    isWireframe: z.boolean(),
    povPos: vec2,
    anchorForceNormal: finiteNumber,
    anchorForceLateral: finiteNumber,
  })
  .partial();

export const trackSchema = z
  .object({
    name: z.string(),
    style: trackStyleSchema,
    heart: finiteNumber,
    friction: finiteNumber.nonnegative(),
    resistance: finiteNumber.nonnegative(),
    sections: z.array(sectionSchema),
    smoothers: z.array(smootherSchema),
    fvdDisplay: fvdTrackDisplaySchema.optional(),
  })
  .refine(
    // Invariant: at most one Closure section per track and, if present,
    // it must be the last section. Enforced both here (file load) and by
    // the store's section-add operations (interactive edits).
    (track) => {
      const closureIndices: number[] = [];
      for (let i = 0; i < track.sections.length; i += 1) {
        if (track.sections[i]!.type === SecType.Closure) closureIndices.push(i);
      }
      if (closureIndices.length === 0) return true;
      if (closureIndices.length > 1) return false;
      return closureIndices[0] === track.sections.length - 1;
    },
    {
      message: 'A track may have at most one Closure section, and it must be last.',
    },
  );

export const projectSchema = z.object({
  texturePath: z.string(),
  tracks: z.array(trackSchema),
  // Default `true` for older WebFVD files that predate this flag — they
  // were authored on the FVD-compatible integrator by definition.
  fvdCompatibilityMode: z.boolean().default(true),
});

// Outer file wrapper — the first two fields identify the format and version
// ahead of any data so the reader can dispatch migrations before schema
// validation (spec §8.1).
export const webFvdFileV4Schema = z.object({
  format: z.literal('webfvd'),
  version: z.literal(4),
  project: projectSchema,
});

export type WebFvdFileV4 = z.infer<typeof webFvdFileV4Schema>;

// Back-compat aliases so existing callers don't all need to rename at once.
export const webFvdFileV1Schema = webFvdFileV4Schema;
export type WebFvdFileV1 = WebFvdFileV4;
export const webFvdFileV2Schema = webFvdFileV4Schema;
export type WebFvdFileV2 = WebFvdFileV4;
export const webFvdFileV3Schema = webFvdFileV4Schema;
export type WebFvdFileV3 = WebFvdFileV4;
