// SPDX-License-Identifier: AGPL-3.0-only
//
// Minimal Qt 4 stand-ins so reference/openfvd/core can compile without
// Qt for the x87 parity oracle. GUI calls become no-ops; container and
// string semantics mirror what the core code relies on.
#ifndef FVD_ORACLE_QT_MINIMAL_H
#define FVD_ORACLE_QT_MINIMAL_H

#include <vector>
#include <deque>
#include <string>
#include <cstdio>
#include <cstdarg>
#include <cstring>
#include <sstream>

// ---- debug output --------------------------------------------------
inline void fvdLogV(const char* lvl, const char* fmt, va_list ap) {
    std::fprintf(stderr, "[%s] ", lvl);
    std::vfprintf(stderr, fmt, ap);
    std::fprintf(stderr, "\n");
}
inline void qDebug(const char* fmt, ...) { (void)fmt; }
inline void qWarning(const char* fmt, ...) {
    va_list ap; va_start(ap, fmt); fvdLogV("warn", fmt, ap); va_end(ap);
}
inline void qCritical(const char* fmt, ...) {
    va_list ap; va_start(ap, fmt); fvdLogV("crit", fmt, ap); va_end(ap);
}

// ---- QString ---------------------------------------------------------
class QString {
public:
    std::string s;
    QString() {}
    QString(const char* c) : s(c) {}
    QString(char c) : s(1, c) {}
    int length() const { return (int)s.size(); }
    std::string toStdString() const { return s; }
    bool isEmpty() const { return s.empty(); }
    QString& append(const QString& o) { s += o.s; return *this; }
    QString arg(int) const { return *this; }
    QString arg(unsigned int) const { return *this; }
    static QString number(double v) {
        std::ostringstream os; os << v; return QString(os.str().c_str());
    }
    static QString number(int v) {
        std::ostringstream os; os << v; return QString(os.str().c_str());
    }
    bool operator==(const QString& o) const { return s == o.s; }
};

// ---- containers ------------------------------------------------------
// Qt 4 QList value semantics. One deliberate quirk: operator[] out of
// bounds returns a zeroed element instead of UB — FVD++ reads OOB on
// freshly-loaded Freeform subfuncs (empty valueList) and in practice
// gets zeros; the TS port matched that behavior against the NL2 golds.
template <typename T>
class QList {
public:
    std::deque<T> d;
    void append(const T& v) { d.push_back(v); }
    void prepend(const T& v) { d.push_front(v); }
    void insert(int i, const T& v) {
        if (i > (int)d.size()) i = (int)d.size();
        d.insert(d.begin() + i, v);
    }
    int size() const { return (int)d.size(); }
    bool isEmpty() const { return d.empty(); }
    T& operator[](int i) { if (i < 0 || i >= (int)d.size()) { zero_ = T(); return zero_; } return d[i]; }
    const T& operator[](int i) const { if (i < 0 || i >= (int)d.size()) { zero_ = T(); return zero_; } return d[i]; }
    const T& at(int i) const { return d[i]; }
    T& last() { return d.back(); }
    T& back() { return d.back(); }
    const T& last() const { return d.back(); }
    T& first() { return d.front(); }
    const T& first() const { return d.front(); }
    void removeAt(int i) { d.erase(d.begin() + i); }
    void removeLast() { d.pop_back(); }
    void removeFirst() { d.pop_front(); }
    void clear() { d.clear(); }
    int indexOf(const T& v) const {
        for (int i = 0; i < (int)d.size(); ++i) if (d[i] == v) return i;
        return -1;
    }
private:
    static T zero_;
};
template <typename T> T QList<T>::zero_;

template <typename T>
class QVector {
public:
    std::vector<T> d;
    QVector() {}
    explicit QVector(size_t n) : d(n) {}
    int size() const { return (int)d.size(); }
    bool isEmpty() const { return d.empty(); }
    T& operator[](int i) { return d[(size_t)i]; }
    const T& operator[](int i) const { return d[(size_t)i]; }
    const T& at(int i) const { return d[(size_t)i]; }
    void append(const T& v) { d.push_back(v); }
    void prepend(const T& v) { d.insert(d.begin(), v); }
    void insert(int i, const T& v) { d.insert(d.begin() + i, v); }
    void reserve(int n) { d.reserve((size_t)n); }
    void removeAt(int i) { d.erase(d.begin() + i); }
    void removeLast() { d.pop_back(); }
    void removeFirst() { d.erase(d.begin()); }
    void clear() { d.clear(); }
    T& last() { return d.back(); }
    T& back() { return d.back(); }
    const T& last() const { return d.back(); }
    T& first() { return d.front(); }
    const T& first() const { return d.front(); }
};

#ifndef Q_UNUSED
#define Q_UNUSED(x) (void)(x);
#endif

// ---- misc ------------------------------------------------------------
// Qt 4 QColor is 16 bytes (spec enum + 5 ushorts + padding). The track
// (de)serializer memcpys 3 of them, so only the SIZE matters.
struct QColor { unsigned char opaque[16]; };

class QElapsedTimer {
public:
    void start() {}
    long long nsecsElapsed() const { return 0; }
};

namespace Qt {
enum CheckState { Unchecked = 0, PartiallyChecked = 1, Checked = 2 };
enum { AlignHCenter = 0x4, AlignVCenter = 0x80, ItemIsEditable = 0x2 };
}

// Stores per-column text: smoothHandler round-trips the smooth NAME
// through treeItem->setText(1, ...) / text(1) at save/load time, so the
// stub must be a real store, not a no-op.
class QTreeWidgetItem {
public:
    QString cols[8];
    void setText(int c, const QString& t) { if (c >= 0 && c < 8) cols[c] = t; }
    QString text(int c) const { return (c >= 0 && c < 8) ? cols[c] : QString(); }
    void setTextAlignment(int, int) {}
    int flags() const { return 0; }
    void setFlags(int) {}
    void setSelected(bool) {}
    void setCheckState(int, Qt::CheckState) {}
    Qt::CheckState checkState(int) const { return Qt::Unchecked; }
};

class QErrorMessage {};
class QFile {};
class QDialog {};

#endif
