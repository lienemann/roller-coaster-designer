// SPDX-License-Identifier: AGPL-3.0-only
//
// Stub implementation of secnlcsv for the parity oracle. NoLimits CSV
// sections never appear in the parity corpus or testtrack; the real
// secnlcsv.cpp drags in QFile/QByteArray CSV parsing we don't need.
// Every entry point aborts loudly if a CSV section is ever exercised.
#include "secnlcsv.h"
#include <cstdio>
#include <cstdlib>

static void unsupported(const char* what) {
    std::fprintf(stderr, "fvd-oracle: secnlcsv::%s is not supported\n", what);
    std::abort();
}

secnlcsv::secnlcsv(track* getParent, mnode* first) : section(getParent, nolimitscsv, first) {}
int secnlcsv::updateSection(int) { unsupported("updateSection"); return 0; }
void secnlcsv::saveSection(std::fstream&) { unsupported("saveSection"); }
void secnlcsv::loadSection(std::fstream&) { unsupported("loadSection"); }
void secnlcsv::legacyLoadSection(std::fstream&) { unsupported("legacyLoadSection"); }
void secnlcsv::saveSection(std::stringstream&) { unsupported("saveSection"); }
void secnlcsv::loadSection(std::stringstream&) { unsupported("loadSection"); }
float secnlcsv::getMaxArgument() { return 0.f; }
bool secnlcsv::isLockable(func*) { return false; }
bool secnlcsv::isInFunction(int, subfunc*) { return false; }
void secnlcsv::loadTrack(QString) { unsupported("loadTrack"); }
void secnlcsv::initDistances() { unsupported("initDistances"); }
mnode secnlcsv::getNodeAtDistance(float) { unsupported("getNodeAtDistance"); return mnode(); }
