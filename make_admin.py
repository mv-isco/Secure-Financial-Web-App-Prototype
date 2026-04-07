import sqlite3

username = input("Enter the username to make Admin: ")

conn = sqlite3.connect('banking.db')
cursor = conn.cursor()

# Check if user exists
cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
user = cursor.fetchone()

if user:
    cursor.execute("UPDATE users SET role = 'admin' WHERE username = ?", (username,))
    conn.commit()
    print(f"SUCCESS: User '{username}' is now an Admin!")
else:
    print("User not found.")

conn.close()