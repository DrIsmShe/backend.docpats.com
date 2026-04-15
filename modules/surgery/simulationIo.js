// Shared io holder — позволяет воркеру получить io
// после того как он создан в bootstrap()

let _io = null;

export const setSimulationIo = (io) => {
  _io = io;
};

export const getSimulationIo = () => _io;
