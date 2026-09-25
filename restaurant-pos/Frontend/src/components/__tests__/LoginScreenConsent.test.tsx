/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the LoginScreen legal-consent gate (per-account consent).
 *
 * Consent is stored in localStorage under 'pos_legal_consent' as a JSON map
 * { [username]: true } so one account's acceptance never satisfies another.
 * The legacy device-wide '1' flag is migrated to { __legacy__: true } and
 * still satisfies every account. The checkbox hides only once a TYPED
 * username matches a previously-consented account (or the legacy flag), and
 * consent is persisted only after a sign-in actually succeeds. In PIN and
 * employee-grid views there is no username input, so the checkbox always
 * shows on a fresh mount there.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import LoginScreen from '../auth/LoginScreen';

const mockLogin = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useAuth', () => ({
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

  it('hides the checkbox for an account that already accepted (legacy device-wide flag)', () => {
    localStorage.setItem('pos_legal_consent', '1');
    render(<LoginScreen onLoginSuccess={vi.fn()} />);
    // The checkbox hides only after the accepted account's username is typed.
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. owner_ratjs/), {
      target: { value: 'test_owner' },
    });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/I agree to the/)).not.toBeInTheDocument();
  });

  it('hides the checkbox for an account with a per-account acceptance', () => {
    localStorage.setItem('pos_legal_consent', JSON.stringify({ test_owner: true }));
    render(<LoginScreen onLoginSuccess={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. owner_ratjs/), {
      target: { value: 'test_owner' },
    });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it("does not let one account's acceptance satisfy another account", () => {
    localStorage.setItem('pos_legal_consent', JSON.stringify({ alice: true }));
    render(<LoginScreen onLoginSuccess={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. owner_ratjs/), {
      target: { value: 'bob' },
    });
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('shows the consent checkbox again after consent is cleared on the device', () => {
    localStorage.setItem('pos_legal_consent', '1');
    const { unmount } = render(<LoginScreen onLoginSuccess={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. owner_ratjs/), {
      target: { value: 'test_owner' },
    });
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

  it('shows the consent prompt in PIN mode on a fresh mount even when consent was recorded (per-session in PIN view)', () => {
    localStorage.setItem('pos_legal_consent', JSON.stringify({ ravi: true }));
    render(<LoginScreen onLoginSuccess={vi.fn()} loginMethod="pin" />);
    // PIN view has no username input, so persisted consent is never looked up
    // before the PIN is submitted — the checkbox always renders there.
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('keeps the consent prompt in tap-to-open mode on a new device', () => {
    render(<LoginScreen onLoginSuccess={vi.fn()} loginMethod="tap_only" />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('shows the consent prompt in tap-to-open mode on a fresh mount even when consent was recorded (per-session in grid view)', () => {
    localStorage.setItem('pos_legal_consent', JSON.stringify({ 'ravi kumar': true }));
    render(
      <LoginScreen
        onLoginSuccess={vi.fn()}
        loginMethod="tap_only"
        employees={
          [
            { id: 'emp1', name: 'Ravi Kumar', role: 'Cashier', status: 'Active' },
          ] as any
        }
      />,
    );
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
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

  it('persists per-account consent only after a successful password login', async () => {
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
    expect(JSON.parse(localStorage.getItem('pos_legal_consent') || '{}')).toEqual({
      test_owner: true,
    });
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

  it('persists consent keyed by the tapped employee after a successful tap-to-open login', () => {
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
    expect(JSON.parse(localStorage.getItem('pos_legal_consent') || '{}')).toEqual({
      'ravi kumar': true,
    });
  });
});
