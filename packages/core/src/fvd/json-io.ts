// SPDX-License-Identifier: AGPL-3.0-only
//
// `.webfvd.json` — the native project format, version 1. (Earlier
// schema numbers belonged to the pre-unification model and were never
// published; this is a clean start.) The payload is a ProjectDoc
// (fvd/doc.ts): FVD++-native section parameters plus the explicitly
// marked WebFVD extensions.

import { z } from 'zod';

import { WebFvdError } from '../errors.js';

import { type ProjectDoc } from './doc.js';
import { EDegree } from './subfunction.js';

const vec3Doc = z.tuple([z.number(), z.number(), z.number()]);

const subfuncSchema = z.object({
  degree: z.nativeEnum(EDegree),
  minArgument: z.number(),
  maxArgument: z.number(),
  startValue: z.number(),
  symArg: z.number(),
  arg1: z.number(),
  centerArg: z.number(),
  tensionArg: z.number(),
  locked: z.boolean(),
  pointList: z
    .tuple([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number()])])
    .optional(),
});

const funcSchema = z.object({ subfuncs: z.array(subfuncSchema) });

const sectionBase = {
  name: z.string(),
  color: z.string().optional(),
};

const speedFields = {
  bSpeed: z.boolean(),
  fVel: z.number(),
};

const forcedShape = {
  ...sectionBase,
  ...speedFields,
  iTime: z.number().int(),
  bOrientation: z.boolean(),
  bArgument: z.boolean(),
  rollFunc: funcSchema,
  normForce: funcSchema,
  latForce: funcSchema,
};

const sectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('straight'),
    ...sectionBase,
    ...speedFields,
    fHLength: z.number(),
    rollFunc: funcSchema,
  }),
  z.object({
    kind: z.literal('curved'),
    ...sectionBase,
    ...speedFields,
    bOrientation: z.boolean(),
    fAngle: z.number(),
    fRadius: z.number(),
    fDirection: z.number(),
    fLeadIn: z.number(),
    fLeadOut: z.number(),
    rollFunc: funcSchema,
  }),
  z.object({ kind: z.literal('forced'), ...forcedShape }),
  z.object({ kind: z.literal('geometric'), ...forcedShape }),
  z.object({
    kind: z.literal('bezier'),
    ...sectionBase,
    knots: z.array(
      z.object({
        P1: vec3Doc,
        Kp1: vec3Doc,
        Kp2: vec3Doc,
        roll: z.number(),
        contRoll: z.boolean(),
        relRoll: z.boolean(),
      }),
    ),
    supports: z.array(vec3Doc).optional(),
  }),
  z.object({ kind: z.literal('closure'), ...sectionBase }),
]);

const smootherSchema = z.object({
  name: z.string(),
  from: z.number().int(),
  to: z.number().int(),
  length: z.number().int(),
  iterations: z.number().int(),
  active: z.boolean(),
});

const trackSchema = z.object({
  name: z.string(),
  startPos: vec3Doc,
  startYaw: z.number(),
  startPitch: z.number(),
  anchor: z.object({
    roll: z.number(),
    vel: z.number(),
    normal: z.number(),
    lateral: z.number(),
  }),
  heart: z.number(),
  friction: z.number(),
  resistance: z.number(),
  style: z.number().int(),
  sections: z.array(sectionSchema),
  smoothers: z.array(smootherSchema),
  fvdDisplay: z
    .object({
      colorsHex: z.string(),
      drawTrack: z.boolean(),
      drawHeartline: z.number().int(),
      isWireframe: z.boolean(),
      povX: z.number(),
      povY: z.number(),
    })
    .optional(),
});

const projectSchema = z.object({
  fvdCompatibilityMode: z.boolean().default(true),
  tracks: z.array(trackSchema),
});

const fileSchema = z.object({
  format: z.literal('webfvd'),
  version: z.literal(1),
  project: projectSchema,
});

export function parseWebFvdJson(text: string): ProjectDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WebFvdError('io.json.notJson');
  }
  const result = fileSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new WebFvdError('io.json.schema', {
      path: issue ? issue.path.join('.') : '',
      detail: issue ? issue.message : '',
    });
  }
  return result.data.project as ProjectDoc;
}

export function stringifyWebFvdJson(project: ProjectDoc): string {
  return JSON.stringify(
    { format: 'webfvd', version: 1, project },
    // Stable key order keeps diffs reviewable and saves idempotent.
    (_key, value: unknown) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const rec = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(rec).sort()) {
          if (rec[k] !== undefined) sorted[k] = rec[k];
        }
        return sorted;
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new WebFvdError('io.json.nonFinite');
      }
      return value;
    },
    2,
  );
}
