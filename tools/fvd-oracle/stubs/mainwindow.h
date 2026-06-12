#ifndef FVD_ORACLE_MAINWINDOW_H
#define FVD_ORACLE_MAINWINDOW_H
#include "QString"
class optionsMenu;
class MainWindow {
public:
    MainWindow() : mOptions(0) {}
    optionsMenu* mOptions;
    void showMessage(const QString&, int) {}
    void setUndoButtons() {}
};
#endif
