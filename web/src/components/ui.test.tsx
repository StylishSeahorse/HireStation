import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Field, Input, StatusBadge, Table, Td } from './ui';

afterEach(cleanup);

describe('ui primitives', () => {
  it('associates Field labels with their control (accessibility)', () => {
    render(<Field label="Contact email" error="Required"><Input /></Field>);
    expect(screen.getByLabelText('Contact email').tagName).toBe('INPUT');
    expect(screen.getByText('Required')).toBeTruthy();
  });

  it('renders status labels', () => {
    render(<StatusBadge status="CONTRACT_SIGNED" />);
    expect(screen.getByText('Contract signed')).toBeTruthy();
  });

  it('shows the empty message only when there are no rows', () => {
    const { rerender } = render(<Table head={['A']} empty="Nothing">{[]}</Table>);
    expect(screen.getByText('Nothing')).toBeTruthy();
    rerender(<Table head={['A']} empty="Nothing">{[<tr key="1"><Td>row</Td></tr>]}</Table>);
    expect(screen.queryByText('Nothing')).toBeNull();
  });
});
