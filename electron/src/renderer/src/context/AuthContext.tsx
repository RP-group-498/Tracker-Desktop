import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';

interface User {
    id: string;
    email?: string;
    name?: string;
    picture?: string;
}

interface AuthContextType {
    isAuthenticated: boolean;
    token: string | null;
    user: User | null;
    login: () => void;
    logout: () => void;
    isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [token, setToken] = useState<string | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    useEffect(() => {
        // Check for existing token on load
        const checkAuthStatus = async () => {
            try {
                const storedToken = await window.electronAPI.getAuthToken();
                if (storedToken) {
                    setToken(storedToken);
                    setIsAuthenticated(true);
                    // Optionally fetch user profile with token here
                }
            } catch (err) {
                console.error('Failed to restore auth session:', err);
            } finally {
                setIsLoading(false);
            }
        };

        checkAuthStatus();

        // Listen for auth success events from main process
        window.electronAPI.onAuthSuccess((authData: any) => {
            setToken(authData.token);
            setIsAuthenticated(true);
            if (authData.user) {
                setUser(authData.user);
            }
        });

        return () => {
            // Handle cleanup if needed (can be added to preload API later)
        };
    }, []);

    const login = () => {
        setIsLoading(true);
        // Trigger OAuth flow in main process
        window.electronAPI.startOAuthLogin().catch((err: any) => {
            console.error('Login failed to start:', err);
            setIsLoading(false);
        });
    };

    const logout = async () => {
        await window.electronAPI.clearAuth();
        setToken(null);
        setUser(null);
        setIsAuthenticated(false);
    };

    return (
        <AuthContext.Provider value={{ isAuthenticated, token, user, login, logout, isLoading }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
