#ifndef FVD_ORACLE_SMOOTHUI_H
#define FVD_ORACLE_SMOOTHUI_H
// The real smoothUi applies the roll smoother; the corpus / testtrack
// parity paths never have an active smoother attached at load time
// (track.cpp:246 guards on `smoother && smoother->active()` and
// `smoother` is only set from the GUI).
class smoothUi {
public:
    bool active() { return false; }
    void applyRollSmooth(int) {}
};
#endif
