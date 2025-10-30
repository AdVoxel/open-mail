# Open Mail - Electron + React + Redux App

A modern desktop application built with Electron, React, and Redux.

## Development

### Prerequisites
- Node.js (v16 or higher)
- npm

### Installation
1. Install dependencies:
   ```bash
   npm install
   ```

2. Start development mode:
   ```bash
   npm run dev
   ```

This will start:
- Webpack dev server for React app (port 3000)
- Electron main process in watch mode

### Build

Build the application for production:
```bash
npm run build
```

### Package

Create distributable packages:
```bash
npm run dist
```

## Project Structure

```
src/
├── main/           # Electron main process
│   ├── main.js     # Main process entry point
│   └── preload.js  # Preload script for security
└── renderer/       # React renderer process
    ├── components/ # React components
    ├── features/   # Redux slices and features
    ├── store/      # Redux store configuration
    ├── App.js      # Main React component
    └── index.js    # React entry point
```

## Features

- Modern React 18 with hooks
- Redux Toolkit for state management
- Hot reloading during development
- Secure Electron configuration
- Cross-platform packaging
