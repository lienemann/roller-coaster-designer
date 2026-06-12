#ifndef FVD_ORACLE_TRACKWIDGET_H
#define FVD_ORACLE_TRACKWIDGET_H
// Faithful, GUI-free mirror of the trackWidget calls that
// track::loadTrack drives. Section creation follows
// sectionHandler::sectionHandler (core/sectionhandler.cpp:23) +
// trackWidget::addSection (ui/trackwidget.cpp:149) exactly:
//   newSection(type, handlerCount-1); sName = "unnamed";
//   updateTrack(newSection, 0);
// updateAnchorGeometrics mirrors ui/trackwidget.cpp (it MUTATES the
// anchor node's fPitchFromLast / fYawFromLast — not GUI-only!).
#include "track.h"
#include "trackhandler.h"  // the REAL core header; ctor defined in driver.cpp

class trackWidget {
public:
    trackHandler* inTrack;
    int handlerCount; // sectionList.size(); slot 0 is the anchor handler

    trackWidget() : inTrack(0), handlerCount(1) {}

    void addSection(enum secType type) {
        track* t = inTrack->trackData;
        int id = handlerCount++;
        t->newSection(type, id - 1);
        t->lSections[id - 1]->sName = QString("unnamed");
        t->updateTrack(t->lSections[id - 1], 0);
    }
    void addStraightSec() { addSection(straight); }
    void addCurvedSec() { addSection(curved); }
    void addForceSec() { addSection(forced); }
    void addGeometricSec() { addSection(geometric); }

    // Mirrors ui/trackwidget.cpp:619 — NOT GUI-only: it mutates the
    // anchor node's fPitchFromLast / fYawFromLast, which the FIRST
    // section's node-0 anchoring consumes (geometric sections read
    // anchor getPitchChange/getYawChange). The .fvd file's saved
    // startValues reflect the AUTHORING session (fresh track, anchor
    // deltas zero), while the NL2 golds reflect a LOAD→EXPORT run where
    // this mutation is active — both oracles are consistent with
    // applying it on load, exactly like the real binary.
    void updateAnchorGeometrics() {
        mnode* a = inTrack->trackData->anchorNode;
        glm::vec3 forceVec = glm::vec3(0, 1, 0) + a->forceNormal * a->vNorm + a->forceLateral * a->vLat;
        glm::vec3 pitchVec = (float)cos(a->fRoll * F_PI / 180) * a->vNorm - (float)sin(a->fRoll * F_PI / 180) * a->vLat;
        glm::vec3 yawVec = (float)sin(a->fRoll * F_PI / 180) * a->vNorm + (float)cos(a->fRoll * F_PI / 180) * a->vLat;
        a->fPitchFromLast = glm::dot(forceVec, pitchVec) / a->fVel * 1.8 / F_PI;
        a->fYawFromLast = glm::dot(forceVec, yawVec) / a->fVel * 1.8 / F_PI;
    }
    void clearSelection() {}
    void setNames() {}
};
#endif
