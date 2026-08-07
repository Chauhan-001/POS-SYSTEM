# POS_ARCHITECTURE.md — POS Terminal Desktop Architecture

## Overview

The POS terminal application (`restaurant-pos`) is designed specifically for fast touch-screen and keyboard interaction in retail and restaurant environments.

---

## 1. Key Performance Features

- **Keyboard Shortcuts**: Native hotkey handling (`F1` for Search, `F2` for Customer Phone, `F8` for Hold, `F9` for Quick Checkout).
- **Responsive Flexbox Engine**: Built with dynamic `100%` viewport calculation to prevent bottom cropping on low-resolution or high-DPI displays.
- **Thermal Printing Pipeline**: Direct KOT and receipt formatting with ESC/POS styling support.
