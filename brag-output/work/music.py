# 120 bpm, 20s, every hit on the 0.5s beat grid counted from t=0. Soft pad + bass + kick/hat, cut accents.
import math, wave, struct, random
SR=44100; DUR=20.0; N=int(SR*DUR); BEAT=0.5
random.seed(7)
L=[0.0]*N
def add(t0,sig,gain=1.0):
    i0=int(t0*SR)
    for k,v in enumerate(sig):
        i=i0+k
        if i>=N: break
        L[i]+=v*gain
def tone(f,d,a=.02,r=.25,harm=((1,1.0),(2,.25),(3,.08))):
    n=int(d*SR); out=[]
    for k in range(n):
        t=k/SR; env=min(1,t/a)*min(1,(d-t)/r) if d-t<r else min(1,t/a)
        out.append(env*sum(w*math.sin(2*math.pi*f*h*t) for h,w in harm))
    return out
def kick():
    n=int(.28*SR);return [math.sin(2*math.pi*(55+90*math.exp(-k/SR*30))*k/SR)*math.exp(-k/SR*11) for k in range(n)]
def hat():
    n=int(.05*SR);return [(random.random()*2-1)*math.exp(-k/SR*90) for k in range(n)]
def tick(f):
    return tone(f,.35,.003,.3,((1,1),(2,.4)))
# chords per 4s (8 beats): Am, F, C, G, Am  (root freq, third, fifth)
N_={'A':220,'C':261.63,'E':329.63,'F':174.61,'G':196.0,'B':246.94,'D':293.66}
chords=[('A',[220,261.63,329.63]),('F',[174.61,220,261.63]),('C',[261.63,329.63,392.0]),('G',[196.0,246.94,293.66]),('A',[220,261.63,329.63])]
for ci,(r,notes) in enumerate(chords):
    t0=ci*4.0
    for f in notes: add(t0,tone(f,4.0,.4,.8,((1,1),(2,.12))),.05)
    for b in range(8):  # bass on every beat, octave pattern
        add(t0+b*BEAT,tone(notes[0]/2,.4,.01,.3,((1,1),(2,.2))),.22 if b%2==0 else .13)
# drums enter at 3.0 (after hook), fade out for last second
for b in range(int(DUR/BEAT)):
    t=b*BEAT
    if 3.0<=t<19.0:
        if b%2==0: add(t,kick(),.5)
        else: add(t,hat(),.06)
    if b%2==1 and 3.0<=t<19.0 and False: pass
# melody pluck on offbeats in scenes 3-4
mel=[329.63,392.0,440.0,392.0,329.63,293.66,329.63,261.63]
for i,b in enumerate(range(int(7/BEAT),int(16/BEAT))):
    if b%2==1: add(b*BEAT,tone(mel[i%8]*(2 if i%16>8 else 1),.4,.005,.35,((1,1),(2,.3))),.09)
# accents on cuts (3,7,12,16) and soft taps on each word reveal in hook
for t,f in ((3.0,880),(7.0,659.25),(12.0,880),(16.0,1046.5)): add(t,tick(f),.10)
for t in (0.0,.5,1.0,1.5,2.0): add(t,tick(1174.66 if t<2 else 1568),.05)
# final chord swell tail + fade
for i in range(N):
    t=i/SR
    if t>19.0: L[i]*=max(0,(20.0-t))
    L[i]*=min(1,t/.05)
peak=max(abs(x) for x in L); g=.85/peak
with wave.open('music.wav','w') as w:
    w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<hh',int(x*g*32000),int(x*g*32000)) for x in L))
print('ok',peak)
