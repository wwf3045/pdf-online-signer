# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-05-15

### Added
- **Multi-Domain Traffic Isolation**: Implemented a three-domain architecture (`sign.pdf.*` for frontend, `api.pdf.*` for API, and `websocket.ecs.*` for real-time signatures) to resolve edge acceleration routing conflicts.
- **Dedicated WebSocket Tunnel**: Created a dedicated, unaccelerated WebSocket endpoint via remote ECS proxy to ensure reliable long-lived connections for mobile signing.
- **Full-Stack Dual-Stack Support**: Enabled IPv4 and IPv6 dual-stack listening across the entire stack (Nginx, Node.js Backend, and Vite Dev Server).
- **Enhanced IP Detection**: Backend now detects and reports all available IPv4 and IPv6 addresses for better mobile-desktop connectivity.
- **Multi-Format Document Support**: The system now supports signing Word (.doc, .docx), Excel (.xls, .xlsx), CSV, Text, and Image (.jpg, .png, .webp, etc.) files.
- **Auto-Conversion to PDF**: Non-PDF files fetched from Lark Base are automatically converted to PDF format on the server for a seamless signing experience.
- **Enhanced Signing UX**: Added loading animations and clear progress indicators when transitioning between multiple documents in the signing queue.
- **Completion Success Screen**: Introduced a dedicated success view with celebratory visuals shown once all selected documents are successfully signed and uploaded.
- **Window Management**: Added a "Close Window" button to the final success screen for easier navigation in embedded environments.
- **Improved File Visualization**: File selection list now features format-specific icons and badges (Word, Excel, Image, PDF) for better clarity.
- **Lark Base Multi-file Support**: The system now supports records with multiple PDF attachments.
- **File Selection UI**: Added a new UI for selecting specific files to sign when multiple attachments are detected.
- **Sequential Signing Queue**: Users can now select multiple documents and sign them one by one in a streamlined workflow.
- **Session ID Optimization**: Improved `/api/lark/init` to reuse existing session IDs for the same record, preventing duplicate session creation.

### Fixed
- **IPv4/IPv6 Listener Regression**: Fixed a regression where the server would only listen on IPv6, restoring full IPv4 accessibility.
- **Vite Dev Server Binding**: Fixed a hostname resolution error (`ENOTFOUND [::]`) in the Vite development server when running under PM2.
- **Nginx Dual-Stack Conflicts**: Resolved potential port conflicts in Nginx by using the `ipv6only=on` flag.
- Fixed an issue where signing multiple files would overwrite existing attachments in the Lark Base output field; now new signatures are appended.
- Fixed an issue where loading PDFs from Lark Base would fail with a 400 error.
- Updated the Lark attachment download URL's `extra` parameter to use `bitablePerm` format for better compatibility with production Base tables.
