// SPDX-License-Identifier: AGPL-3.0-only

import { EDegree, type ProjectDoc, type SectionDoc } from '@roller-coaster-designer/core';

import { singleSubfuncFunc, subfunc } from '../state/store.js';

/**
 * Handcrafted demo: 25° drop, 90° banked turn (roll up / hold / unbank
 * across the turn angle), a tilted 360° loop (fDirection = 12° so the
 * exit clears the entry sideways), and a Closure back to the anchor.
 * Roll-rate values are °/s of ridden angle (FVD Curved semantics).
 */
export function createDemoProject(): ProjectDoc {
  const drop: SectionDoc = {
    kind: 'straight',
    name: 'Drop',
    bSpeed: false,
    fVel: 15,
    fHLength: 18,
    rollFunc: singleSubfuncFunc(0, 18),
  };

  const turn: SectionDoc = {
    kind: 'curved',
    name: 'Banked turn',
    bSpeed: false,
    fVel: 15,
    bOrientation: false,
    fAngle: 90,
    fRadius: 18,
    fDirection: 90,
    fLeadIn: 12,
    fLeadOut: 12,
    rollFunc: {
      subfuncs: [
        subfunc(0, 30, 0, 0.6, EDegree.Cubic),
        subfunc(30, 60, 0.6, 0, EDegree.Cubic),
        subfunc(60, 90, 0.6, -0.6, EDegree.Cubic),
      ],
    },
  };

  const leadIn: SectionDoc = {
    kind: 'straight',
    name: 'Loop lead-in',
    bSpeed: false,
    fVel: 15,
    fHLength: 10,
    rollFunc: singleSubfuncFunc(0, 10),
  };

  const loop: SectionDoc = {
    kind: 'curved',
    name: 'Loop',
    bSpeed: false,
    fVel: 15,
    bOrientation: false,
    fAngle: 360,
    fRadius: 8,
    fDirection: 12,
    fLeadIn: 25,
    fLeadOut: 25,
    rollFunc: singleSubfuncFunc(0, 360),
  };

  const leadOut: SectionDoc = {
    kind: 'straight',
    name: 'Loop lead-out',
    bSpeed: false,
    fVel: 15,
    fHLength: 8,
    rollFunc: singleSubfuncFunc(0, 8),
  };

  return {
    fvdCompatibilityMode: true,
    tracks: [
      {
        name: 'Demo',
        startPos: [0, 28, 0],
        startYaw: 0,
        startPitch: -25,
        anchor: { roll: 0, vel: 15, normal: 1, lateral: 0 },
        heart: 1.1,
        friction: 0,
        resistance: 0,
        style: 0,
        sections: [drop, turn, leadIn, loop, leadOut, { kind: 'closure', name: 'Closure' }],
        smoothers: [],
      },
    ],
  };
}
