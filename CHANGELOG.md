# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Lark Base Multi-file Support**: The system now supports records with multiple PDF attachments.
- **File Selection UI**: Added a new UI for selecting specific files to sign when multiple attachments are detected.
- **Sequential Signing Queue**: Users can now select multiple documents and sign them one by one in a streamlined workflow.
- **Session ID Optimization**: Improved `/api/lark/init` to reuse existing session IDs for the same record, preventing duplicate session creation.

### Fixed
- Fixed an issue where signing multiple files would overwrite existing attachments in the Lark Base output field; now new signatures are appended.
- Fixed an issue where loading PDFs from Lark Base would fail with a 400 error.
- Updated the Lark attachment download URL's `extra` parameter to use `bitablePerm` format for better compatibility with production Base tables.
