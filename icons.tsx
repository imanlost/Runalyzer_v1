import React from 'react';

export const Icons = {
    Run: () => <i className="fa-solid fa-person-running text-[#34C759] text-xl"></i>,
    Bike: () => <i className="fa-solid fa-bicycle text-blue-500 text-xl"></i>,
    Swim: () => <i className="fa-solid fa-person-swimming text-cyan-500 text-xl"></i>,
    Clock: () => <i className="fa-regular fa-clock text-yellow-300"></i>,
    Flame: () => <i className="fa-solid fa-fire text-orange-400"></i>,
    Heart: () => <i className="fa-solid fa-heart text-red-500"></i>,
    Map: () => <i className="fa-solid fa-map-location-dot text-purple-400"></i>,
    Upload: () => <i className="fa-solid fa-cloud-arrow-up text-sky-400"></i>,
    Trophy: () => <i className="fa-solid fa-trophy text-yellow-500"></i>,
    Trend: () => <i className="fa-solid fa-arrow-trend-up text-emerald-400"></i>,
    Lungs: () => <i className="fa-solid fa-lungs text-pink-400"></i>,
    Warning: () => <i className="fa-solid fa-triangle-exclamation text-amber-500"></i>,
    Trash: () => <i className="fa-solid fa-trash"></i>,
    Clear: () => <i className="fa-solid fa-eraser"></i>,
    Save: () => <i className="fa-solid fa-floppy-disk text-indigo-400"></i>,
    Download: () => <i className="fa-solid fa-file-export text-blue-400"></i>,
    Import: () => <i className="fa-solid fa-file-import text-green-400"></i>,
    Mountain: () => <i className="fa-solid fa-mountain text-emerald-400"></i>,
    Gauge: () => <i className="fa-solid fa-gauge-high text-red-400"></i>,
    Ruler: () => <i className="fa-solid fa-ruler text-blue-400"></i>,
    Search: () => <i className="fa-solid fa-magnifying-glass text-gray-400"></i>,
    Calendar: () => <i className="fa-solid fa-calendar-days text-blue-300"></i>,
    ChevronDown: () => <i className="fa-solid fa-chevron-down text-gray-400"></i>,
    ChevronRight: () => <i className="fa-solid fa-chevron-right text-gray-400"></i>,
    ChevronLeft: () => <i className="fa-solid fa-chevron-left text-gray-400"></i>,
    Info: () => <i className="fa-solid fa-circle-info text-blue-400"></i>,
    Stop: () => <i className="fa-solid fa-stop text-red-500"></i>,
    Folder: () => <i className="fa-solid fa-folder-open text-yellow-200"></i>,
    Check: () => <i className="fa-solid fa-check text-green-500"></i>,
    XMark: () => <i className="fa-solid fa-xmark text-gray-400"></i>,
    Pen: () => <i className="fa-solid fa-pen text-gray-400"></i>,
    User: () => <i className="fa-solid fa-user text-blue-400"></i>,
    Bolt: () => <i className="fa-solid fa-bolt text-yellow-400"></i>,
    Chart: () => <i className="fa-solid fa-chart-area text-purple-400"></i>,
    List: () => <i className="fa-solid fa-list text-gray-300"></i>,
    ListCheck: () => <i className="fa-solid fa-list-check text-teal-400"></i>,
    Flag: () => <i className="fa-solid fa-flag-checkered text-gray-100"></i>,
    Square: () => <i className="fa-regular fa-square text-gray-500"></i>,
    SquareCheck: () => <i className="fa-solid fa-square-check text-[#34C759]"></i>,
    Battery: () => <i className="fa-solid fa-battery-half text-green-400"></i>,
    Medal: () => <i className="fa-solid fa-medal text-yellow-300"></i>,
    Brain: () => <i className="fa-solid fa-brain text-pink-400"></i>
};

export const getSportConfig = (sport: string) => {
    switch (sport) {
        case 'RUNNING': return { icon: <Icons.Run />, color: 'text-[#34C759]' };
        case 'CYCLING': return { icon: <Icons.Bike />, color: 'text-blue-500' };
        case 'SWIMMING': return { icon: <Icons.Swim />, color: 'text-cyan-500' };
        case 'TRAIL_RUNNING': return { icon: <Icons.Mountain />, color: 'text-green-700' };
        case 'HIIT': return { icon: <Icons.Bolt />, color: 'text-orange-500' };
        case 'WALKING': return { icon: <Icons.User />, color: 'text-yellow-500' };
        case 'HIKING': return { icon: <Icons.Map />, color: 'text-brown-500' };
        default: return { icon: <Icons.Square />, color: 'text-gray-400' };
    }
};