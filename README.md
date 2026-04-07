# 🏦 Secure Financial Web App Prototype
### Bridging Cybersecurity and Practical Web Development

![FullStack](https://img.shields.io/badge/Stack-Fullstack-green)
![Security](https://img.shields.io/badge/Auth-Zero--Trust-red)
![Status](https://img.shields.io/badge/Status-Prototype-yellow)

A full-stack banking web application prototype designed to implement secure coding practices. This project demonstrates how to build defensive mechanisms directly into a modern web stack to protect financial data.

---

### 🔒 Core Security Implementations

* **Zero-Trust Authentication:** * Integrates a **Two-Factor Authentication (2FA)** flow.
    * Manages sessions securely using **HTTP-only JSON Web Tokens (JWT)**.
* **Vulnerability Mitigation:** Implements comprehensive input sanitization to block **Cross-Site Scripting (XSS)** and **SQL Injection** attacks.
* **Transaction Integrity:** * Uses server-side logic to strictly validate account balances.
    * Enforces **Broken Access Control** checks.
    * Utilizes **CSRF tokens** to protect frontend data entry points.

### 💻 Tech Stack
* **Frontend:** React, Tailwind CSS.
* **Backend:** Node.js, Express.
* **Authentication:** JWT, 2FA Logic.
