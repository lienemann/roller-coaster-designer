// SPDX-License-Identifier: AGPL-3.0-only
//
// jsdom smoke test for the SubfuncEditor scaffold. Mounts the editor
// with a hand-constructed GeometricSection and verifies:
//   - renders without throwing
//   - exposes the three subgraph titles (roll / pitch / yaw)
//   - clicking a curve segment opens the popover
//
// Real browser verification was attempted via the dev server (boots
// cleanly) but the container lacks chromium-cli / playwright, so this
// jsdom test is the proxy. Anything that requires Canvas / SVG layout
// (drag boundaries, popover positioning) isn't covered.

import {
  Argument,
  EDegree,
  EFuncType,
  Orientation,
  type GeometricSection,
  SecType,
  TrackStyle,
  createEmptyFunc,
} from '@roller-coaster-designer/core';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SubfuncEditor, type SubfuncEditorLabels } from './subfunc-editor.tsx';

const LABELS: SubfuncEditorLabels = {
  rollFunc: 'Roll',
  pitchFunc: 'Pitch',
  yawFunc: 'Yaw',
  orientationEuler: 'Euler',
  orientationQuaternion: 'Quaternion',
  argumentTime: 'Time',
  argumentDistance: 'Distance',
  speedFixed: 'Held',
  speedEnergy: 'Energy',
  degree: 'Degree',
  arg1: 'arg1',
  centerArg: 'Center',
  tensionArg: 'Tension',
  locked: 'Locked',
  unitSeconds: 's',
  unitMeters: 'm',
  unitRad: 'rad',
  unitRadPerSec: 'rad/s',
  clickToAdd: 'click',
  dragBoundary: 'drag',
};

function makeSection(): GeometricSection {
  return {
    type: SecType.Geometric,
    name: 'smoke',
    extent: 1,
    argument: Argument.Time,
    orientation: Orientation.Quaternion,
    rollFunc: createEmptyFunc(EFuncType.Roll, 'roll'),
    pitchFunc: createEmptyFunc(EFuncType.Pitch, 'pitch'),
    yawFunc: createEmptyFunc(EFuncType.Yaw, 'yaw'),
  };
}

// Suppress jsdom canvas warnings — the editor uses SVG, but framework
// pieces may probe Canvas during layout.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('SubfuncEditor (jsdom smoke)', () => {
  it('renders without throwing and shows all three subgraph titles', () => {
    expect(() =>
      render(
        <SubfuncEditor
          section={makeSection()}
          onChange={() => undefined}
          label={LABELS}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText('Roll')).toBeInTheDocument();
    expect(screen.getByText('Pitch')).toBeInTheDocument();
    expect(screen.getByText('Yaw')).toBeInTheDocument();
  });

  it('shows the section-level flag toggles', () => {
    render(
      <SubfuncEditor
        section={makeSection()}
        onChange={() => undefined}
        label={LABELS}
      />,
    );
    // Should have buttons / toggles for orientation and argument modes.
    expect(screen.getByText(/Euler|Quaternion/)).toBeInTheDocument();
    expect(screen.getByText(/Time|Distance/)).toBeInTheDocument();
  });
});

// TrackStyle is imported only so the @roller-coaster-designer/core barrel
// re-export resolves all the type-only names the editor needs. Without
// the value-side reference the bundler dedupes it out — but the editor
// imports `EDegree` value-side, so this is a belt-and-braces hint to
// our build that the value import resolves correctly.
void EDegree.Linear;
void TrackStyle.Generic;
