import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  decrement,
  increment,
  incrementByAmount,
  selectCount,
} from '../features/counter/counterSlice';

export function Counter() {
  const count = useSelector(selectCount);
  const dispatch = useDispatch();
  const [incrementAmount, setIncrementAmount] = useState('2');

  const incrementValue = Number(incrementAmount) || 0;

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Open Mail App</h1>
      <div style={{ marginBottom: '20px' }}>
        <button
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            margin: '0 10px',
            cursor: 'pointer'
          }}
          onClick={() => dispatch(decrement())}
        >
          -
        </button>
        <span style={{ fontSize: '24px', margin: '0 20px' }}>{count}</span>
        <button
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            margin: '0 10px',
            cursor: 'pointer'
          }}
          onClick={() => dispatch(increment())}
        >
          +
        </button>
      </div>
      <div>
        <input
          style={{
            padding: '8px',
            fontSize: '16px',
            marginRight: '10px',
            width: '100px'
          }}
          value={incrementAmount}
          onChange={(e) => setIncrementAmount(e.target.value)}
        />
        <button
          style={{
            padding: '8px 16px',
            fontSize: '16px',
            cursor: 'pointer'
          }}
          onClick={() => dispatch(incrementByAmount(incrementValue))}
        >
          Add Amount
        </button>
      </div>
      <p style={{ marginTop: '20px', color: '#666' }}>
        Welcome to your Electron + React + Redux app!
      </p>
    </div>
  );
}
