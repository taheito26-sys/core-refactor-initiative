import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { LookupMenuPortal } from '@/components/shared/LookupMenuPortal';
const C = () => { const r = useRef<HTMLDivElement>(null); return <div><div ref={r}>a</div><LookupMenuPortal anchorRef={r} onClose={() => {}}><button>x</button></LookupMenuPortal></div>; };
describe('LookupMenuPortal', () => { it('renders without looping', () => { render(<C />); expect(screen.getByText('x')).toBeTruthy(); }); });
