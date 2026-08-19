/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the LoginScreen legal-consent gate: the "I agree to the Terms &
 * Conditions and Privacy Policy" checkbox must appear ONLY on a new device
 * (no recorded acceptance) and must STAY visible — checked or not — until the
 * first sign-in actually succeeds. Consent is persisted to the device only on
 * a successful login, never the moment the checkbox is clicked. On a device
 * that already accepted, the checkbox is hidden and sign-in is unlocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import LoginScreen from '../LoginScreen';

const mockLogin = vi.hoisted(() => vi.fn());

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    isLoading: false,
    user: null,
    restaurant: null,
    employee: null,
    error: null,
    login: mockLogin,
    logout: vi.fn().mockResolvedValue(undefined),
    refreshSession: vi.fn().mockResolvedValue(undefined),
    clearError: vi.fn(),
  }),
}));

describe('LoginScreen legal consent', () => {
  beforeEach(() => {
    localStorage.clear();
    mockLogin.mockReset();
    mockLogin.mockResolvedValue({}); // default: no employee / user → no login
  });

  it('shows the consent checkbox on a new device (no remembered acceptance)', () => {
    render(<LoginScreen onLoginSuccess={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.getByText(/I agree to the/)).toBeInTheDocument();
  });

  it('hides the consent checkbox when this device already accepted', () => {
    localStorage.setItem('pos_legal_consent', '1');
    render(<LoginScreen onLoginSuccess={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/I agree to the/)).not.toBeInTheDocument();
  });

  it('shows the consent checkbox again after consent is cleared on the device', () => {
    localStorage.setItem('pos_legal_consent', '1');
    const { unmount } = render(<LoginScreen onLoginSuccess={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    unmount();

    localStorage.removeItem('pos_legal_consent');
    render(<LoginScreen onLoginSuccess={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('keeps the consent prompt in PIN mode on a new device', () => {
    render(<LoginScreen onLoginSuccess={vi.fn()} loginMethod="pin" />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('hides the consent prompt in PIN mode once accepted on this device', () => {
    localStorage.setItem('pos_legal_consent', '1');
    render(<LoginScreen onLoginSuccess={vi.fn()} loginMethod="pin" />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('keeps the consent prompt in tap-to-open mode on a new device', () => {
    render(<LoginScreen onLoginSuccess={vi.fn()} loginMethod="tap_only" />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('hides the consent prompt in tap-to-open mode once accepted on this device', () => {
    localStorage.setItem('pos_legal_consent', '1');
    render(<LoginScreen onLoginSuccess={vi.fn()} loginMethod="tap_only" />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('keeps the checkbox visible and does NOT persist consent when clicked before login', () => {
    render(<LoginScreen onLoginSuccess={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(checkbox);
    // The prompt must not vanish the moment the box is clicked.
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(checkbox.checked).toBe(true);
    // And consent must not be recorded on this device yet.
    expect(localStorage.getItem('pos_legal_consent')).toBeNull();
  });

  it('persists consent on the device only after a successful password login', async () => {
    mockLogin.mockResolvedValue({
      employee: { id: 'emp1', name: 'Test Owner', role: 'Owner' },
    });
    const onLoginSuccess = vi.fn();
    render(<LoginScreen onLoginSuccess={onLoginSuccess} />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. owner_ratjs/), {
      target: { value: 'test_owner' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'secret123' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /Sign In to POS/i }));

    await waitFor(() => expect(onLoginSuccess).toHaveBeenCalled());
    expect(localStorage.getItem('pos_legal_consent')).toBe('1');
  });

  it('does NOT persist consent when the password login fails', async () => {
    mockLogin.mockResolvedValue({}); // empty result → treated as failed login
    const onLoginSuccess = vi.fn();
    render(<LoginScreen onLoginSuccess={onLoginSuccess} />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. owner_ratjs/), {
      target: { value: 'test_owner' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'wrongpass' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /Sign In to POS/i }));

    await waitFor(() => expect(mockLogin).toHaveBeenCalled());
    expect(onLoginSuccess).not.toHaveBeenCalled();
    expect(localStorage.getItem('pos_legal_consent')).toBeNull();
  });

  it('persists consent on the device after a successful tap-to-open login', () => {
    const onLoginSuccess = vi.fn();
    render(
      <LoginScreen
        onLoginSuccess={onLoginSuccess}
        loginMethod="tap_only"
        employees={
          [
            { id: 'emp1', name: 'Ravi Kumar', role: 'Cashier', status: 'Active' },
          ] as any
        }
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Ravi Kumar'));

    expect(onLoginSuccess).toHaveBeenCalled();
    expect(localStorage.getItem('pos_legal_consent')).toBe('1');
  });
});
