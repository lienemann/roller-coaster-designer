# FVD++ parity oracle: compiles the REAL reference/openfvd/core physics
# (with Qt stubbed out) with the same FPU model as the shipped FVD++
# 0.79 Windows binary (bin/win64/FVD.exe: x86-64 SSE2, MinGW-w64 GCC
# 6.2.0), plus a driver that loads .fvd files and dumps per-node float
# bit patterns as ground truth for the WebFVD float-emulation campaign.
#
#   make            # requires reference/openfvd and reference/glm
#                     (clone glm tag 0.9.8.0 — the era of the shipped
#                      binary; measured: 0.9.5.x/0.9.6.x export differently)
#   ./fvd-oracle dump  <file.fvd>          # per-node field bits
#   ./fvd-oracle nl2   <file.fvd> <m>      # NL2 element export
#   ./fvd-oracle resave <file.fvd> <out>   # load → save byte oracle

REF      := ../../reference/openfvd
GLM      ?= ../../reference/glm
CXX      := g++
# The shipped FVD++ 0.79 Windows binary (bin/win64/FVD.exe) is x86-64,
# MSYS2 MinGW-w64 GCC 6.2.0 — SSE2 math, FLT_EVAL_METHOD == 0. Build
# native x86-64 to match.
CXXFLAGS := -O2 -fno-strict-aliasing -w \
            -DNDEBUG \
            -DQT_NO_DEBUG \
            -Istubs -I$(REF)/core -I$(REF) -I$(GLM)

CORE_SRCS := exportfuncs.cpp mnode.cpp function.cpp subfunction.cpp \
             section.cpp secstraight.cpp seccurved.cpp secforced.cpp \
             secgeometric.cpp secbezier.cpp \
             smoothhandler.cpp track.cpp
OBJS := $(CORE_SRCS:%.cpp=build/%.o) build/driver.o build/secnlcsv-stub.o build/libm-model.o

fvd-oracle: $(OBJS)
	$(CXX) -o $@ $(OBJS)

build/%.o: $(REF)/core/%.cpp | build
	$(CXX) $(CXXFLAGS) -c -o $@ $<

build/driver.o: driver.cpp | build
	$(CXX) $(CXXFLAGS) -c -o $@ $<

build/secnlcsv-stub.o: secnlcsv-stub.cpp | build
	$(CXX) $(CXXFLAGS) -c -o $@ $<

build/libm-model.o: libm-model.cpp | build
	$(CXX) $(CXXFLAGS) -c -o $@ $<

build:
	mkdir -p build

# Assembly listings for the rounding-placement audit: read where fstps
# (store-to-float32) lands in the optimized hot loops.
asm: | build
	$(CXX) $(CXXFLAGS) -S -o build/mnode.s $(REF)/core/mnode.cpp
	$(CXX) $(CXXFLAGS) -S -o build/secgeometric.s $(REF)/core/secgeometric.cpp
	$(CXX) $(CXXFLAGS) -S -o build/seccurved.s $(REF)/core/seccurved.cpp
	$(CXX) $(CXXFLAGS) -S -o build/subfunction.s $(REF)/core/subfunction.cpp

# Windows libm probe: fully static .exe to run once on the Windows
# machine that exported the NL2 golds (no setup needed there):
#   msvcrt-probe.exe > msvcrt-probe.txt
# The native build of the same source emits the glibc baseline.
probe: msvcrt-probe.exe probe-native
msvcrt-probe.exe: msvcrt-probe.c
	x86_64-w64-mingw32-gcc -O2 -static -o $@ $<
probe-native: msvcrt-probe.c
	$(CC) -O2 -o $@ $< -lm

clean:
	rm -rf build fvd-oracle msvcrt-probe.exe probe-native

.PHONY: clean asm probe
