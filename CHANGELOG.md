# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
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
- Fixed an issue where signing multiple files would overwrite existing attachments in the Lark Base output field; now new signatures are appended.
- Fixed an issue where loading PDFs from Lark Base would fail with a 400 error.
- Updated the Lark attachment download URL's `extra` parameter to use `bitablePerm` format for better compatibility with production Base tables.
