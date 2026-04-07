import sqlite3

def create_database():
    conn = sqlite3.connect('banking.db')
    c = conn.cursor()

    # 1. USERS Table (Stores user info and HASHED passwords)
    # Security Note: we store 'password_hash', NEVER the actual password.
    # 'failed_attempts' and 'locked_until' are for Brute Force Protection.
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user',  -- 'user' or 'admin'
            failed_attempts INTEGER DEFAULT 0,
            locked_until DATETIME,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 2. ACCOUNTS Table (Stores balance)
    # Security Note: Separate from users table to allow multiple accounts per user later
    c.execute('''
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            account_number TEXT UNIQUE NOT NULL,
            balance REAL DEFAULT 0.0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')

    # 3. TRANSACTIONS Table (Stores history)
    c.execute('''
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_account TEXT,
            to_account TEXT,
            amount REAL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 4. AUDIT_LOGS Table (For Member 4's Security Requirement)
    # Security Note: Immutability is key here. We log security events.
    c.execute('''
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            event_type TEXT,  -- e.g., 'LOGIN_SUCCESS', 'LOGIN_FAIL', 'TRANSFER'
            ip_address TEXT,
            details TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    conn.commit()
    conn.close()
    print("Database 'banking.db' created successfully with secure schema.")

if __name__ == '__main__':
    create_database()