import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import BusinessText from './BusinessText';

/**
 * Issue #37: a browser translating the page also translated the names ERPNext holds, so
 * "Additional IPs" was read as something else on the customer's screen while the request
 * still carried the item code. The interface may be translated; the names may not.
 */
describe('BusinessText', () => {
  it('tells a page translator to leave the name alone', () => {
    render(<BusinessText>Additional IPs</BusinessText>);

    const name = screen.getByText('Additional IPs');

    expect(name).toHaveAttribute('translate', 'no');
    expect(name).toHaveClass('notranslate');
  });

  it('keeps the classes it is given', () => {
    render(<BusinessText className="font-bold">Kakivu Mousse</BusinessText>);

    expect(screen.getByText('Kakivu Mousse')).toHaveClass('notranslate', 'font-bold');
  });
});
