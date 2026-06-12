// SPDX-License-Identifier: AGPL-3.0-only
//
// libm selection for the parity oracle.
//
// The shipped FVD++ 0.79 Windows binary (reference/openfvd/bin/win64/
// FVD.exe) is x86-64, built by MSYS2 MinGW-w64 GCC 6.2.0 — SSE2 math,
// FLT_EVAL_METHOD == 0. Float libm variants come from mingw-w64's
// libmingwex, doubles from the 64-bit msvcrt — both SSE2-based and
// close to glibc. Start with glibc untouched; certification against
// the FVD++-authored golds is the arbiter for any per-function shim.
#include <cmath>
