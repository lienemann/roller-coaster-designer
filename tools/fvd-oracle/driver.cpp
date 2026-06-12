// SPDX-License-Identifier: AGPL-3.0-only
//
// Driver for the x87 parity oracle. Loads a .fvd file through the REAL
// reference/openfvd track/section/mnode code (compiled -m32 -mfpmath=387,
// the FPU model of the shipped FVD++ 0.79 MinGW build) and emits ground
// truth for the WebFVD float-emulation campaign:
//
//   fvd-oracle dump   <file.fvd>           per-node float fields, bit-exact hex
//   fvd-oracle nl2    <file.fvd> <mPerNode> NL2 element XML on stdout
//   fvd-oracle resave <file.fvd> <out.fvd>  load → save (byte oracle)
//
// The .fvd envelope ("FVD" + version + background + TRC blocks + EOP)
// mirrors ui/projectwidget.cpp:396-430; the per-track payload goes
// through the real track::loadTrack / track::saveTrack.

#include <cstdio>
#include <cstring>
#include <cstdint>
#include <fstream>
#include <string>

#include "track.h"
#include "trackwidget.h"
#include "trackmesh.h"
#include "mainwindow.h"
#include "exportfuncs.h"

MainWindow* gloParent = new MainWindow();
glViewWidget* glView = new glViewWidget();

// The real core/trackhandler.h declares these; trackhandler.cpp is
// GUI-entangled and not linked, so provide the minimal bodies here.
trackHandler::trackHandler(QString, int) {
    trackData = 0;
    listItem = 0;
    trackWidgetItem = 0;
    graphWidgetItem = 0;
    tabId = 0;
    mMesh = new trackMesh();
    mUndoHandler = 0;
}
trackHandler::~trackHandler() {}
void trackHandler::changeID(int) {}
int trackHandler::getID() { return 0; }

static void fail(const char* msg) {
    std::fprintf(stderr, "fvd-oracle: %s\n", msg);
    std::exit(1);
}

struct LoadedTrack {
    trackHandler* handler;
    trackWidget* widget;
    track* trk;
};

// Reads the envelope and returns the FIRST track fully loaded through
// track::loadTrack (the corpus and testtrack parity paths only use
// track 0). Leaves the stream right after that track's EOT.
static LoadedTrack loadFirstTrack(std::fstream& file, std::string& versionOut,
                                  std::string& backgroundOut) {
    std::string magic = readString(&file, 3);
    if (magic != "FVD") fail("not an FVD file");
    versionOut = readString(&file, 5);
    int bgLen = readInt(&file);
    backgroundOut = readString(&file, bgLen);

    std::string tag = readString(&file, 3);
    if (tag != "TRC") fail("expected TRC");

    LoadedTrack lt;
    lt.handler = new trackHandler(QString("oracle"), 0);
    lt.widget = new trackWidget();
    lt.trk = new track(lt.handler, glm::vec3(0.f, 0.f, 0.f), 0.f, 0.f);
    lt.handler->trackData = lt.trk;
    lt.widget->inTrack = lt.handler;

    QString result = lt.trk->loadTrack(file, lt.widget);
    if (!(result == QString("Load Successful"))) fail("loadTrack failed");
    return lt;
}

static uint32_t bitsOf(float f) {
    uint32_t u;
    std::memcpy(&u, &f, 4);
    return u;
}

static void dumpNode(int sec, int node, mnode* n) {
    // One line per node; every float32 field as 8 hex digits, in a
    // fixed order the TS harness mirrors.
    std::printf(
        "%d %d %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x "
        "%08x %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x\n",
        sec, node,
        bitsOf(n->vPos.x), bitsOf(n->vPos.y), bitsOf(n->vPos.z),
        bitsOf(n->vDir.x), bitsOf(n->vDir.y), bitsOf(n->vDir.z),
        bitsOf(n->vLat.x), bitsOf(n->vLat.y), bitsOf(n->vLat.z),
        bitsOf(n->vNorm.x), bitsOf(n->vNorm.y), bitsOf(n->vNorm.z),
        bitsOf(n->fRoll), bitsOf(n->fVel), bitsOf(n->fEnergy),
        bitsOf(n->fRollSpeed),
        bitsOf(n->fDistFromLast), bitsOf(n->fTotalLength),
        bitsOf(n->fHeartDistFromLast), bitsOf(n->fTotalHeartLength),
        bitsOf(n->fPitchFromLast), bitsOf(n->fYawFromLast),
        bitsOf(n->fAngleFromLast), bitsOf(n->fTrackAngleFromLast),
        bitsOf(n->forceNormal));
    // forceLateral / fDirFromLast on a continuation field to keep the
    // schema append-only: add here if needed.
    (void)0;
}

static void setX87DoublePrecision() {
    // Only relevant for -m32 x87 experiment builds; the shipped binary
    // is x86-64 SSE2 where no control-word precision games exist.
#if defined(__i386__)
    unsigned short cw;
    __asm__ volatile("fnstcw %0" : "=m"(cw));
    cw = (unsigned short)((cw & ~0x0300) | 0x0200);
    __asm__ volatile("fldcw %0" : : "m"(cw));
#endif
}

int main(int argc, char** argv) {
    setX87DoublePrecision();
    if (argc < 3) fail("usage: fvd-oracle dump|nl2|resave <file.fvd> [arg]");
    const char* cmd = argv[1];

    std::fstream file(argv[2], std::ios::in | std::ios::binary);
    if (!file.is_open()) fail("cannot open input");
    std::string version, background;
    LoadedTrack lt = loadFirstTrack(file, version, background);

    if (std::strcmp(cmd, "dump") == 0) {
        // Header: field order for the harness.
        std::printf("# sec node vPos.xyz vDir.xyz vLat.xyz vNorm.xyz fRoll fVel "
                    "fEnergy fRollSpeed fDistFromLast fTotalLength "
                    "fHeartDistFromLast fTotalHeartLength fPitchFromLast "
                    "fYawFromLast fAngleFromLast fTrackAngleFromLast forceNormal\n");
        for (int s = 0; s < lt.trk->lSections.size(); ++s) {
            section* sec = lt.trk->lSections[s];
            for (int i = 0; i < sec->lNodes.size(); ++i) {
                dumpNode(s, i, &sec->lNodes[i]);
            }
        }
        // Per-section func state after integration (the stitched
        // startValues — the anchor quantities).
        for (int s = 0; s < lt.trk->lSections.size(); ++s) {
            section* sec = lt.trk->lSections[s];
            func* fns[3] = { sec->rollFunc, sec->normForce, sec->latForce };
            const char* names[3] = { "roll", "norm", "lat" };
            for (int f = 0; f < 3; ++f) {
                if (!fns[f]) continue;
                for (int k = 0; k < fns[f]->funcList.size(); ++k) {
                    subfunc* sf = fns[f]->funcList[k];
                    std::printf("F %d %s %d %08x %08x %08x %08x\n", s, names[f], k,
                                bitsOf(sf->startValue), bitsOf(sf->symArg),
                                bitsOf(sf->minArgument), bitsOf(sf->maxArgument));
                }
            }
        }
    } else if (std::strcmp(cmd, "nl2") == 0) {
        float mPerNode = argc > 3 ? (float)atof(argv[3]) : 2.0f;
        lt.trk->exportNL2Track(stdout, mPerNode, 0, lt.trk->lSections.size() - 1);
    } else if (std::strcmp(cmd, "resave") == 0) {
        if (argc < 4) fail("resave needs an output path");
        std::fstream out(argv[3], std::ios::out | std::ios::binary | std::ios::trunc);
        out << "FVD";
        out << version;
        int bgLen = (int)background.size();
        writeBytes(&out, (const char*)&bgLen, sizeof(int));
        out << background;
        lt.trk->saveTrack(out, lt.widget);
        // Preserve any remaining tracks of the input verbatim? No — the
        // byte oracle only compares the first TRC block; the harness
        // truncates both sides to the first track.
        out << "EOP";
        out.close();
    } else {
        fail("unknown command");
    }
    return 0;
}
