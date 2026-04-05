# Layla Calendar

A modern, AI-powered calendar application that helps users manage their daily schedule with intelligent assistance. Built with React Native and Tauri for a seamless cross-platform experience.

## Features

- 📅 **Intuitive Calendar Interface** - Clean, user-friendly calendar management
- 🤖 **AI Assistant** - Built-in AI companion to help plan your day
- 🔐 **OAuth Integration** - Secure Google Calendar integration
- ⚡ **Performance** - Fast, responsive interface powered by Tauri
- 🎨 **Modern UI** - Professional design with TypeScript type safety

## Tech Stack

<p align="left">
    <img alt="React Native" src="https://img.shields.io/badge/React%20Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-20232A?style=for-the-badge&logo=tauri&logoColor=61DAFB" />
    <img alt="Rust" src="https://img.shields.io/badge/Rust-20232A?style=for-the-badge&logo=rust&logoColor=61DAFB" />
    <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" />
</p>

## Project Structure

```
Layla-Calendar/
├── src/                        # React Frontend (TypeScript)
│   ├── components/            # React components
│   ├── pages/                 # Application pages
│   ├── App.tsx               # Main application component
│   └── main.tsx              # Entry point
├── src-tauri/                 # Tauri Backend (Rust)
│   ├── src/                  # Rust source code
│   └── Cargo.toml           # Rust dependencies
├── src-python/               # Python utilities
├── layla-calendar-oauth/     # OAuth Proxy (Cloudflare Workers)
│   ├── src/                 # OAuth handler code
│   └── wrangler.jsonc       # Cloudflare configuration
├── layla-calender-log/       # Logging module
├── package.json             # Node dependencies
├── tsconfig.json            # TypeScript configuration
├── vite.config.ts           # Vite build configuration
└── README.md                # This file
```

## Prerequisites

- **Node.js** (v18 or higher)
- **Bun** (package manager) - [Install Bun](https://bun.sh)
- **Rust** (for Tauri backend) - [Install Rust](https://rustup.rs)
- **Git** (for cloning the repository)

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/ILikeLayla/HackMIT2026.git
cd Layla-Calendar
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Development Setup

To run the application in development mode:

```bash
bun tauri dev
```

This command will:
- Start the Vite development server
- Build and run the Tauri application
- Enable hot module replacement (HMR)

## Project Components

### Frontend (`src/`)
- **Framework**: React Native with TypeScript
- **Build Tool**: Vite
- **Purpose**: User interface for calendar management and scheduling

### Backend (`src-tauri/`)
- **Language**: Rust
- **Purpose**: Desktop application shell, file system operations, and system integration
- **Platform Support**: Windows, macOS, Linux

### OAuth Proxy (`layla-calendar-oauth/`)
- **Platform**: Cloudflare Workers
- **Purpose**: Secure Google OAuth authentication and calendar event fetching
- **See**: [OAuth README](./layla-calendar-oauth/README.md) for detailed setup

### Python Utilities (`src-python/`)
- **Purpose**: Supporting utilities and helper scripts
- **Use**: Data processing and backend operations

## Development Workflow

### Running in Development

```bash
# Install dependencies
bun install

# Start development server
bun tauri dev
```

### Building for Production

```bash
# Build desktop application
bun tauri build
```

### Available Commands

```bash
# Development
bun tauri dev          # Run in development mode
bun tauri dev --debug # Run with debug logging

# Building
bun tauri build        # Create production builds

# Maintenance
bun install           # Install/update dependencies
```

## Google OAuth Setup

If you want to enable Google Calendar integration:

1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable Google Calendar API
4. Create OAuth 2.0 Web Application credentials
5. Configure redirect URIs as per the [OAuth Proxy README](./layla-calendar-oauth/README.md)

## Contributing

We welcome contributions! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Troubleshooting

### Build Issues

If you encounter build issues:

1. Clear dependencies: `rm -rf node_modules && bun install`
2. Rebuild Rust backend: `cd src-tauri && cargo clean`
3. Restart development server: `bun tauri dev`

### OAuth Issues

Refer to the [OAuth Proxy README](./layla-calendar-oauth/README.md) for troubleshooting authentication issues.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues, questions, or suggestions:
- 📧 Open an issue on [GitHub](https://github.com/ILikeLayla/HackMIT2026/issues)
- 💬 Start a discussion for feature requests

## Acknowledgments

- Built for HackMIT 2026
- Powered by [Tauri](https://tauri.app/)
- Enhanced with [React](https://react.dev/)
- Secured by [Cloudflare Workers](https://workers.cloudflare.com/)