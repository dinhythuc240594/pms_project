import { createContext, useContext } from 'react';
export const PmsContext = createContext(null);
export const usePms = () => useContext(PmsContext);
