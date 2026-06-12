// SPDX-License-Identifier: AGPL-3.0-only
//
// msvcrt libm probe for the FVD++ parity campaign.
//
// The shipped FVD++ 0.79 binary (x86-64 MinGW-w64) takes its double-
// precision math from the OS's msvcrt.dll, whose implementations are
// closed source. This probe captures their exact bit-level behavior
// over the argument ranges the FVD++ integrator exercises, so the
// WebFVD compat integrator (and tools/fvd-oracle) can replicate them.
//
// On Windows it resolves every function from msvcrt.dll at runtime via
// GetProcAddress — capturing exactly what FVD.exe gets — and falls
// back to the statically linked C runtime for anything msvcrt doesn't
// export (reported as such). Built natively on Linux, the same source
// emits the glibc baseline for diffing.
//
// Usage (on the Windows machine that exported the NL2 golds):
//   msvcrt-probe.exe > msvcrt-probe.txt
//
// Output: one line per evaluation, all values as IEEE-754 bit patterns:
//   <fn> <argbits> [<arg2bits>] <resultbits>
// 64-bit hex for doubles, 32-bit hex for floats. Deterministic: the
// argument set is fixed, so two runs (or two machines) diff cleanly.

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#endif

static uint64_t dbits(double v) {
    uint64_t u;
    memcpy(&u, &v, 8);
    return u;
}
static uint32_t fbits(float v) {
    uint32_t u;
    memcpy(&u, &v, 4);
    return u;
}

// Deterministic PRNG (xorshift64*) so the argument set is identical on
// every machine and run.
static uint64_t rngState = 0x9e3779b97f4a7c15ull;
static uint64_t rngNext(void) {
    uint64_t x = rngState;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    rngState = x;
    return x * 0x2545f4914f6cdd1dull;
}
static double uniform(double lo, double hi) {
    return lo + (hi - lo) * ((double)(rngNext() >> 11) / 9007199254740992.0);
}

typedef double (*fn1_t)(double);
typedef double (*fn2_t)(double, double);
typedef float (*ffn1_t)(float);
typedef float (*ffn2_t)(float, float);

#ifdef _WIN32
static HMODULE gMsvcrt;
static void* resolve(const char* name) {
    return (void*)GetProcAddress(gMsvcrt, name);
}
#else
static void* resolve(const char* name) {
    (void)name;
    return NULL; // native build: always use the local libm fallback
}
#endif

static void probe1(const char* name, fn1_t fallback, int n, double lo, double hi,
                   int logSpaced) {
    fn1_t f = (fn1_t)resolve(name);
    const char* src = f ? "msvcrt" : "crt";
    if (!f) f = fallback;
    printf("# %s source=%s\n", name, src);
    for (int i = 0; i < n; i++) {
        double x;
        if (logSpaced) {
            // log-spaced magnitudes in [lo, hi] (both signs alternate)
            double t = uniform(log(lo), log(hi));
            x = exp(t) * ((i & 1) ? -1.0 : 1.0);
        } else {
            x = uniform(lo, hi);
        }
        printf("%s %016llx %016llx\n", name, (unsigned long long)dbits(x),
               (unsigned long long)dbits(f(x)));
    }
}

static void probe2(const char* name, fn2_t fallback, int n, double alo, double ahi,
                   double blo, double bhi) {
    fn2_t f = (fn2_t)resolve(name);
    const char* src = f ? "msvcrt" : "crt";
    if (!f) f = fallback;
    printf("# %s source=%s\n", name, src);
    for (int i = 0; i < n; i++) {
        double a = uniform(alo, ahi);
        double b = uniform(blo, bhi);
        printf("%s %016llx %016llx %016llx\n", name, (unsigned long long)dbits(a),
               (unsigned long long)dbits(b), (unsigned long long)dbits(f(a, b)));
    }
}

static void probeAtan2UnitCircle(const char* name, fn2_t fallback, int n) {
    // Heading-like pairs: atan2(-x, -z) of near-unit direction vectors —
    // the section-anchor measurement path.
    fn2_t f = (fn2_t)resolve(name);
    const char* src = f ? "msvcrt" : "crt";
    if (!f) f = fallback;
    printf("# %s(unit-circle) source=%s\n", name, src);
    for (int i = 0; i < n; i++) {
        double th = uniform(-3.141592653589793, 3.141592653589793);
        double r = 1.0 + uniform(-1e-6, 1e-6);
        // round through float32 like vDir components
        float x = (float)(r * sin(th));
        float z = (float)(-r * cos(th));
        double a = -(double)x, b = -(double)z;
        printf("%s %016llx %016llx %016llx\n", name, (unsigned long long)dbits(a),
               (unsigned long long)dbits(b), (unsigned long long)dbits(f(a, b)));
    }
}

static void probeF1(const char* name, ffn1_t fallback, int n, double lo, double hi,
                    int logSpaced) {
    ffn1_t f = (ffn1_t)resolve(name);
    const char* src = f ? "msvcrt" : "crt";
    if (!f) f = fallback;
    printf("# %s source=%s\n", name, src);
    for (int i = 0; i < n; i++) {
        double xd;
        if (logSpaced) {
            double t = uniform(log(lo), log(hi));
            xd = exp(t) * ((i & 1) ? -1.0 : 1.0);
        } else {
            xd = uniform(lo, hi);
        }
        float x = (float)xd;
        printf("%s %08x %08x\n", name, fbits(x), fbits(f(x)));
    }
}

static void probeF2(const char* name, ffn2_t fallback, int n, double alo, double ahi,
                    double blo, double bhi) {
    ffn2_t f = (ffn2_t)resolve(name);
    const char* src = f ? "msvcrt" : "crt";
    if (!f) f = fallback;
    printf("# %s source=%s\n", name, src);
    for (int i = 0; i < n; i++) {
        float a = (float)uniform(alo, ahi);
        float b = (float)uniform(blo, bhi);
        printf("%s %08x %08x %08x\n", name, fbits(a), fbits(b), fbits(f(a, b)));
    }
}

int main(void) {
    printf("# fvd msvcrt-probe v1\n");
#ifdef _WIN32
    gMsvcrt = LoadLibraryA("msvcrt.dll");
    if (!gMsvcrt) {
        printf("# ERROR: cannot load msvcrt.dll\n");
        return 1;
    }
    char path[MAX_PATH] = {0};
    GetModuleFileNameA(gMsvcrt, path, MAX_PATH);
    printf("# msvcrt: %s\n", path);
    // Windows version (RtlGetVersion bypasses compat shims)
    typedef LONG(WINAPI * RtlGetVersion_t)(PRTL_OSVERSIONINFOW);
    HMODULE ntdll = GetModuleHandleA("ntdll.dll");
    RtlGetVersion_t rtlGetVersion =
        ntdll ? (RtlGetVersion_t)GetProcAddress(ntdll, "RtlGetVersion") : NULL;
    if (rtlGetVersion) {
        RTL_OSVERSIONINFOW vi;
        memset(&vi, 0, sizeof(vi));
        vi.dwOSVersionInfoSize = sizeof(vi);
        if (rtlGetVersion(&vi) == 0) {
            printf("# windows: %lu.%lu build %lu\n", (unsigned long)vi.dwMajorVersion,
                   (unsigned long)vi.dwMinorVersion, (unsigned long)vi.dwBuildNumber);
        }
    }
#else
    printf("# native build (glibc baseline)\n");
#endif

    // ---- doubles: the integrator's call sites ----
    // calcDirFromLast / force blocks: sin & cos over roll/pitch radians
    probe1("sin", sin, 3000, -3.2, 3.2, 0);
    probe1("sin", sin, 1200, 1e-9, 2e-2, 1); // per-step rotation half-angles
    probe1("cos", cos, 3000, -3.2, 3.2, 0);
    probe1("cos", cos, 1200, 1e-9, 2e-2, 1);
    probe1("tan", tan, 800, -1.5, 1.5, 0); // mnode ctor tan(roll)
    probe1("asin", asin, 2000, -1.0, 1.0, 0); // trackangle asin(dirHeart.y)
    probe1("acos", acos, 800, -1.0, 1.0, 0);
    probe1("atan", atan, 800, -10.0, 10.0, 0);
    probe2("atan2", atan2, 2500, -1.0, 1.0, -1.0, 1.0);
    probeAtan2UnitCircle("atan2", atan2, 2500);
    probe1("exp", exp, 1500, -25.0, 5.0, 0); // plateau exp(-arg1*15*(...))
    probe1("log", log, 800, 1e-6, 100.0, 0);
    probe1("sinh", sinh, 1500, -10.0, 10.0, 0); // tension warp
    probe1("sqrt", sqrt, 800, 0.0, 400.0, 0);
    // applyCenter: pow(x, pow(2, c/2)) and plateau pow(1-|2x-1|, 3)
    probe2("pow", pow, 1000, 2.0, 2.0, -6.0, 6.0);   // base exactly 2 (applyCenter)
    probe2("pow", pow, 2000, 0.0, 1.0, 0.18, 35.0);
    probe2("pow", pow, 800, 0.0, 1.0, 3.0, 3.0);
    probe2("pow", pow, 800, 0.0, 8.0, -4.0, 8.0);
    // C99 functions msvcrt may not export (then libmingwex served FVD++):
    probe1("asinh", asinh, 1000, -10.0, 10.0, 0);
    probe1("cbrt", cbrt, 200, -8.0, 8.0, 0);

    // ---- float variants (x64 msvcrt exports many of these) ----
    probeF1("sinf", sinf, 1500, -3.2, 3.2, 0);
    probeF1("sinf", sinf, 800, 1e-7, 2e-2, 1);
    probeF1("cosf", cosf, 1500, -3.2, 3.2, 0);
    probeF1("cosf", cosf, 800, 1e-7, 2e-2, 1);
    probeF1("asinf", asinf, 1000, -1.0, 1.0, 0);
    probeF2("atan2f", atan2f, 2000, -1.0, 1.0, -1.0, 1.0);
    probeF1("sqrtf", sqrtf, 500, 0.0, 400.0, 0);
    probeF1("expf", expf, 500, -25.0, 5.0, 0);
    probeF2("powf", powf, 500, 0.0, 2.0, -6.0, 35.0);

    printf("# done\n");
    return 0;
}
