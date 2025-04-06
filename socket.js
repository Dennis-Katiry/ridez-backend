const socketIo = require('socket.io');
const userModel = require('./models/user.model');
const captainModel = require('./models/captain.model');
const rideModel = require('./models/ride.model');
const adminModel = require('./models/admin.model');

let io;

const throttle = (func, limit) => {
  let lastFunc;
  let lastRan;
  return (...args) => {
    if (!lastRan) {
      func(...args);
      lastRan = Date.now();
    } else {
      clearTimeout(lastFunc);
      lastFunc = setTimeout(() => {
        if (Date.now() - lastRan >= limit) {
          func(...args);
          lastRan = Date.now();
        }
      }, limit - (Date.now() - lastRan));
    }
  };
};

const hasLocationChanged = (prevCoords, newCoords, threshold = 0.0001) => {
  if (!prevCoords || !newCoords) return true;
  const latDiff = Math.abs(prevCoords[1] - newCoords.lat);
  const lngDiff = Math.abs(prevCoords[0] - newCoords.lng);
  return latDiff > threshold || lngDiff > threshold;
};

function initializeSocket(server) {
  if (io) {
    console.log('Socket.io already initialized');
    return io;
  }

  io = socketIo(server, {
    cors: {
      origin: [
        'http://localhost:5173', // Development
        'https://rt5gcc3t-5173.inc1.devtunnels.ms', // Development tunnel
        'http://192.168.1.8:4000', // Local network
        // Add production frontend URL after deployment (e.g., 'https://mern-frontend.onrender.com')
      ],
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  console.log('Socket.io initialized');

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}, from origin: ${socket.handshake.headers.origin}`);
    let startTime;
    let statsInterval;

    socket.on('join', async (data) => {
      const { userId, role } = data;
      console.log(`User ${userId} joined as ${role} with socketId: ${socket.id}`);

      try {
        if (role === 'user') {
          const user = await userModel.findByIdAndUpdate(
            userId,
            { socketId: socket.id },
            { new: true }
          );
          if (!user) throw new Error('User not found');
          if (!socket.rooms.has(`user:${userId}`)) {
            socket.join(`user:${userId}`);
            console.log(`User ${userId} joined room user:${userId}`);
          }
        } else if (role === 'captain') {
          const captain = await captainModel.findByIdAndUpdate(
            userId,
            { socketId: socket.id },
            { new: true }
          );
          if (!captain) throw new Error('Captain not found');
          if (!socket.rooms.has(`captain:${userId}`)) {
            socket.join(`captain:${userId}`);
            console.log(`Captain ${userId} joined room captain:${userId}`);
          }
          startTime = Date.now();
          statsInterval = setInterval(async () => {
            try {
              const today = new Date().setHours(0, 0, 0, 0);
              const onlineTime = (Date.now() - startTime) / (1000 * 60 * 60);

              const captain = await captainModel.findById(userId);
              const todayStats = captain.dailyStats.find(stat => stat.date.getTime() === today);
              if (todayStats) {
                await captainModel.updateOne(
                  { _id: userId, 'dailyStats.date': today },
                  { $set: { 'dailyStats.$.hoursOnline': onlineTime } }
                );
              } else {
                await captainModel.updateOne(
                  { _id: userId },
                  { $push: { dailyStats: { date: today, hoursOnline: onlineTime, earnings: 0, tripsCompleted: 0 } } }
                );
              }

              const updatedCaptain = await captainModel.findById(userId);
              const currentStats = updatedCaptain.dailyStats.find(stat => stat.date.getTime() === today) || {
                earnings: 0,
                hoursOnline: onlineTime,
                tripsCompleted: 0,
              };
              socket.emit('stats-updated', {
                earningsToday: currentStats.earnings,
                hoursOnline: currentStats.hoursOnline,
                tripsToday: currentStats.tripsCompleted,
                rating: updatedCaptain.rating || 0,
              });
            } catch (error) {
              console.error(`Error updating captain stats for ${userId}:`, error);
            }
          }, 60000);

          socket.on('disconnect', () => {
            clearInterval(statsInterval);
          });
        } else if (role === 'admin') {
          const admin = await adminModel.findByIdAndUpdate(
            userId,
            { socketId: socket.id },
            { new: true }
          );
          if (!admin) throw new Error('Admin not found');
          if (!socket.rooms.has('admin-room')) {
            socket.join('admin-room');
            console.log(`Admin ${userId} joined admin-room`);
          }
        } else {
          throw new Error('Invalid role');
        }
      } catch (error) {
        console.error(`Error updating ${role} socketId for userId ${userId}:`, error.message);
        socket.emit('error', { message: `Failed to join as ${role}: ${error.message}` });
      }
    });

    const broadcastLocationUpdate = throttle((rideId, captainLocation, activeRide) => {
      if (activeRide.serviceType === 'taxiPool') {
        activeRide.users.forEach(userEntry => {
          const user = userEntry.userId;
          if (user && user.socketId) {
            io.to(`user:${user._id}`).emit('captain-location-update', {
              rideId: activeRide._id,
              captainLocation: { lat: captainLocation.lat, lng: captainLocation.lng },
            });
            console.log(`Broadcasted captain location to user ${user._id} for ride ${rideId}`);
          }
        });
      } else {
        if (activeRide.user && activeRide.user.socketId) {
          io.to(`user:${activeRide.user._id}`).emit('captain-location-update', {
            rideId: activeRide._id,
            captainLocation: { lat: captainLocation.lat, lng: captainLocation.lng },
          });
          console.log(`Broadcasted captain location to user ${activeRide.user._id} for ride ${rideId}`);
        }
      }
    }, 10000);

    socket.on('captain-location-update', async (data) => {
      const { rideId, captainLocation } = data;
      console.log(`Received captain-location-update for ride ${rideId}:`, captainLocation);

      if (!captainLocation || typeof captainLocation.lat !== 'number' || typeof captainLocation.lng !== 'number') {
        return socket.emit('error', { message: 'Invalid location data' });
      }

      try {
        const captain = await captainModel.findOne({ socketId: socket.id });
        if (!captain) return socket.emit('error', { message: 'Captain not found' });

        const currentCoords = captain.location?.coordinates;
        if (hasLocationChanged(currentCoords, captainLocation)) {
          const updatedCaptain = await captainModel.findByIdAndUpdate(
            captain._id,
            { location: { type: 'Point', coordinates: [captainLocation.lng, captainLocation.lat] } },
            { new: true }
          );
          console.log(`Updated captain location for ${captain._id}:`, updatedCaptain.location);
        } else {
          console.log(`Captain location unchanged for ${captain._id}, skipping database update`);
        }

        const activeRide = await rideModel.findOne({
          _id: rideId,
          captain: captain._id,
          status: { $in: ['accepted', 'ongoing'] },
        }).populate('user').populate('users.userId');

        if (activeRide) broadcastLocationUpdate(rideId, captainLocation, activeRide);
      } catch (error) {
        console.error(`Error processing captain-location-update for ride ${rideId}:`, error);
        socket.emit('error', { message: 'Failed to update location' });
      }
    });

    socket.on('accept-ride', async (data) => {
      const { rideId } = data;
      console.log(`Captain accepted ride ${rideId} from socket ${socket.id}`);
      try {
        const captain = await captainModel.findOne({ socketId: socket.id });
        if (!captain) return socket.emit('error', { message: 'Captain not found' });

        const ride = await rideModel.findByIdAndUpdate(
          rideId,
          { status: 'accepted', captain: captain._id },
          { new: true }
        ).populate('user').populate('users.userId');
        if (!ride) return socket.emit('error', { message: 'Ride not found' });

        if (ride.serviceType === 'taxiPool') {
          ride.users.forEach(userEntry => {
            const user = userEntry.userId;
            if (user && user.socketId) {
              io.to(`user:${user._id}`).emit('ride-accepted', { rideId, status: 'accepted' });
              console.log(`Notified user ${user._id} about ride acceptance`);
            }
          });
        } else {
          if (ride.user && ride.user.socketId) {
            io.to(`user:${ride.user._id}`).emit('ride-accepted', { rideId, status: 'accepted' });
            console.log(`Notified user ${ride.user._id} about ride acceptance`);
          }
        }

        socket.emit('ride-accepted', { rideId, status: 'accepted' });
        console.log(`Ride ${rideId} updated to accepted`);
      } catch (error) {
        console.error(`Error accepting ride ${rideId}:`, error);
        socket.emit('error', { message: 'Failed to accept ride' });
      }
    });

    socket.on('start-ride', async (data) => {
      const { rideId } = data;
      console.log(`Captain started ride ${rideId} from socket ${socket.id}`);
      try {
        const captain = await captainModel.findOne({ socketId: socket.id });
        if (!captain) return socket.emit('error', { message: 'Captain not found' });

        const ride = await rideModel.findOneAndUpdate(
          { _id: rideId, captain: captain._id, status: 'accepted' },
          { status: 'ongoing' },
          { new: true }
        ).populate('user').populate('users.userId');
        if (!ride) return socket.emit('error', { message: 'Ride not found or not eligible to start' });

        if (ride.serviceType === 'taxiPool') {
          ride.users.forEach(userEntry => {
            const user = userEntry.userId;
            if (user && user.socketId) {
              io.to(`user:${user._id}`).emit('ride-status-updated', { rideId, status: 'ongoing' });
              console.log(`Notified user ${user._id} about ride status change to ongoing`);
            }
          });
        } else {
          if (ride.user && ride.user.socketId) {
            io.to(`user:${ride.user._id}`).emit('ride-status-updated', { rideId, status: 'ongoing' });
            console.log(`Notified user ${ride.user._id} about ride status change to ongoing`);
          }
        }

        socket.emit('ride-status-updated', { rideId, status: 'ongoing' });
        console.log(`Ride ${rideId} updated to ongoing`);

        const populatedRide = await rideModel
          .findById(ride._id)
          .populate('user', 'fullname')
          .populate('captain', 'fullname')
          .lean();
        emitToAdminRoom('service-stats-update', {
          id: ride._id.toString(),
          service: ride.serviceType === 'taxiPool' ? 'Taxi Pool' :
            ride.serviceType === 'intercity' ? 'Intercity' :
              ride.serviceType === 'taxiBooking' ? 'Taxi Booking' :
                ride.vehicleType === 'motorcycle' ? 'Bike Ride' :
                  ride.vehicleType === 'car' ? 'Car' : 'Taxi Ride',
          customer: populatedRide.user ? `${populatedRide.user.fullname?.firstname || 'Unknown'} ${populatedRide.user.fullname?.lastname || ''}` : 'Unknown',
          driver: populatedRide.captain ? `${populatedRide.captain.fullname?.firstname || 'Unknown'} ${populatedRide.captain.fullname?.lastname || ''}` : 'Not Assigned',
          status: 'Ongoing',
        });
      } catch (error) {
        console.error(`Error starting ride ${rideId}:`, error);
        socket.emit('error', { message: 'Failed to start ride' });
      }
    });

    socket.on('end-ride', async (data) => {
      const { rideId } = data;
      console.log(`Captain requested to end ride ${rideId}`);
      try {
        const captain = await captainModel.findOne({ socketId: socket.id });
        if (!captain) return socket.emit('error', { message: 'Captain not found' });

        const ride = await rideModel.findOneAndUpdate(
          { _id: rideId, captain: captain._id, status: { $in: ['accepted', 'ongoing'] } },
          { status: 'completed' },
          { new: true }
        ).populate('user').populate('users.userId');
        if (!ride) return socket.emit('error', { message: 'Ride not found or not eligible to end' });

        const today = new Date().setHours(0, 0, 0, 0);
        await captainModel.updateOne(
          { _id: captain._id, 'dailyStats.date': { $ne: today } },
          { $push: { dailyStats: { date: today, earnings: ride.fare, tripsCompleted: 1 } }, $inc: { totalRides: 1 } }
        );
        await captainModel.updateOne(
          { _id: captain._id, 'dailyStats.date': today },
          { $inc: { 'dailyStats.$.earnings': ride.fare, 'dailyStats.$.tripsCompleted': 1, totalRides: 1 } }
        );

        const updatedCaptain = await captainModel.findById(captain._id);
        const todayStats = updatedCaptain.dailyStats.find(stat => stat.date.getTime() === today) || {
          earnings: 0,
          hoursOnline: 0,
          tripsCompleted: 0,
        };
        io.to('admin-room').emit('ride-completed', { rideId: ride._id, captainId: captain._id, totalRides: updatedCaptain.totalRides });
        if (updatedCaptain.socketId) {
          io.to(updatedCaptain.socketId).emit('stats-updated', {
            earningsToday: todayStats.earnings,
            hoursOnline: todayStats.hoursOnline,
            tripsToday: todayStats.tripsCompleted,
            rating: updatedCaptain.rating || 0,
          });
          console.log(`Emitted stats-updated to captain ${captain._id}`);
        }

        if (ride.serviceType === 'taxiPool') {
          await Promise.all(ride.users.map(async (userEntry) => {
            await userModel.updateOne({ _id: userEntry.userId }, { $inc: { totalRides: 1 } });
          }));
        } else {
          await userModel.updateOne({ _id: ride.user }, { $inc: { totalRides: 1 } });
        }

        if (ride.serviceType === 'taxiPool') {
          ride.users.forEach(userEntry => {
            const user = userEntry.userId;
            if (user && user.socketId) {
              io.to(`user:${user._id}`).emit('ride-ended', { rideId: ride._id });
              console.log(`Notified user ${user._id} about ride end`);
            }
          });
        } else {
          if (ride.user && ride.user.socketId) {
            io.to(`user:${ride.user._id}`).emit('ride-ended', { rideId: ride._id });
            console.log(`Notified user ${ride.user._id} about ride end`);
          } else {
            console.error(`User socketId missing for user ${ride.user?._id} in ride ${rideId}`);
          }
        }

        io.to(`captain:${captain._id}`).emit('ride-ended', { rideId: ride._id });
        console.log(`Notified captain ${captain._id} about ride end`);

        console.log(`Ride ${rideId} marked as completed`);

        const populatedRide = await rideModel
          .findById(ride._id)
          .populate('user', 'fullname')
          .populate('captain', 'fullname')
          .lean();
        emitToAdminRoom('service-stats-update', {
          id: ride._id.toString(),
          service: ride.serviceType === 'taxiPool' ? 'Taxi Pool' :
            ride.serviceType === 'intercity' ? 'Intercity' :
              ride.serviceType === 'taxiBooking' ? 'Taxi Booking' :
                ride.vehicleType === 'motorcycle' ? 'Bike Ride' :
                  ride.vehicleType === 'car' ? 'Car' : 'Taxi Ride',
          customer: populatedRide.user ? `${populatedRide.user.fullname?.firstname || 'Unknown'} ${populatedRide.user.fullname?.lastname || ''}` : 'Unknown',
          driver: populatedRide.captain ? `${populatedRide.captain.fullname?.firstname || 'Unknown'} ${populatedRide.captain.fullname?.lastname || ''}` : 'Not Assigned',
          status: 'Completed',
        });
      } catch (error) {
        console.error(`Error ending ride ${rideId}:`, error);
        socket.emit('error', { message: 'Failed to end ride' });
      }
    });

    socket.on('ride-request', async (data) => {
      const { rideId, userLocation } = data;
      console.log(`Received ride-request for ride ${rideId} from user at:`, userLocation);

      try {
        const ride = await rideModel.findById(rideId).populate('user');
        if (!ride || ride.status !== 'pending') {
          return socket.emit('error', { message: 'Ride not found or already assigned' });
        }

        if (!ride.user.isActive) {
          return socket.emit('error', { message: 'Your account is deactivated. You cannot create rides.' });
        }

        if (ride.isScheduled) {
          console.log(`Ride ${rideId} is scheduled. Awaiting admin assignment.`);
          return;
        }

        const nearbyCaptains = await captainModel.find({
          location: {
            $near: {
              $geometry: { type: 'Point', coordinates: [userLocation.lng, userLocation.lat] },
              $maxDistance: 5000,
            },
          },
          socketId: { $ne: null },
        });

        if (nearbyCaptains.length === 0) {
          console.log('No nearby captains found for ride:', rideId);
          io.to(`user:${ride.user._id}`).emit('no-captains-available', { rideId });
          return;
        }

        nearbyCaptains.forEach((captain) => {
          io.to(`captain:${captain._id}`).emit('ride-request', {
            rideId,
            userLocation,
            pickup: ride.pickup,
            destination: ride.destination,
            fare: ride.fare,
          });
          console.log(`Sent ride-request to captain ${captain._id}`);
        });
      } catch (error) {
        console.error(`Error processing ride-request for ride ${rideId}:`, error);
        socket.emit('error', { message: 'Failed to process ride request' });
      }
    });

    socket.on('disconnect', async () => {
      console.log(`Client disconnected: ${socket.id}, from origin: ${socket.handshake.headers.origin}`);
      try {
        const user = await userModel.findOne({ socketId: socket.id });
        if (user) {
          await userModel.findByIdAndUpdate(user._id, { socketId: null });
          console.log(`Cleared socketId for user ${user._id}`);
        }
        const captain = await captainModel.findOne({ socketId: socket.id });
        if (captain && startTime) {
          clearInterval(statsInterval);
          const today = new Date().setHours(0, 0, 0, 0);
          const onlineTime = (Date.now() - startTime) / (1000 * 60 * 60);
          const todayStats = captain.dailyStats.find(stat => stat.date.getTime() === today);
          if (todayStats) {
            await captainModel.updateOne(
              { _id: captain._id, 'dailyStats.date': today },
              { $set: { 'dailyStats.$.hoursOnline': onlineTime } }
            );
          } else {
            await captainModel.updateOne(
              { _id: captain._id },
              { $push: { dailyStats: { date: today, hoursOnline: onlineTime, earnings: 0, tripsCompleted: 0 } } }
            );
          }
          await captainModel.findByIdAndUpdate(captain._id, { socketId: null });
          console.log(`Cleared socketId and updated hoursOnline for captain ${captain._id}`);
        }
        const admin = await adminModel.findOne({ socketId: socket.id });
        if (admin) {
          await adminModel.findByIdAndUpdate(admin._id, { socketId: null });
          console.log(`Cleared socketId for admin ${admin._id}`);
        }
      } catch (error) {
        console.error('Error clearing socketId or updating hoursOnline on disconnect:', error);
      }
    });
  });

  return io;
}

function sendMessageToSocketId(socketId, messageObject) {
  console.log(`Sending message to socketId ${socketId}`, messageObject);
  if (io) {
    io.to(socketId).emit(messageObject.event, messageObject.data);
  } else {
    console.error('Socket.io not initialized. Message not sent.');
  }
}

function getIo() {
  if (!io) {
    console.error('Socket.io not yet initialized. Call initializeSocket first.');
  }
  return io;
}

function emitToAdminRoom(event, data) {
  if (io) {
    io.to('admin-room').emit(event, data);
    console.log(`Emitted ${event} to admin-room:`, data);
  } else {
    console.error('Socket.io not initialized. Cannot emit to admin-room.');
  }
}

module.exports = { initializeSocket, sendMessageToSocketId, getIo, emitToAdminRoom };