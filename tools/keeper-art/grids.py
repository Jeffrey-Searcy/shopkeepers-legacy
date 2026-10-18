"""
Hand-traced 1x pixel maps of the keeper, drawn over the downsampled ChatGPT poster figures.
Each map is a list of equal-length strings; characters are palette keys from palette.py.
"""
FRONT = [
    "......o..o.o......",
    ".....o4oo4oo4o....",
    "...oo34434434443o.",
    "..o3343344344433o.",
    ".o23334433443432o.",
    "o2233343334433322o",
    ".o123332333343221o",
    "o1223321233332221o",
    "o1223212223322121o",
    ".o12321c2232c3221o",
    "o12cc11cccc11cc21o",
    "o12ccewccccewcc21o",
    ".o1bceecccceecb1o.",
    ".o1bceeccbceecb1o.",
    "..oacbccmmccbcao..",
    "...oabccccccbao...",
    "...onBBoaaoBBno...",
    "..oDCBBrRRrBBCBo..",
    ".oDECCBBrRBBCCBno.",
    ".oDCoCDCBrBCBoBno.",
    ".oCBoCDCBBCCBonno.",
    ".ocboCCCBBCBnobao.",
    ".ocboBCCBBBBnobao.",
    ".obaokLLyyLLkobao.",
    ".ocboPPQPPQPpocbo.",
    "..ooooPQPpPQpooo..",
    "....oPQPooPQpo....",
    "....oPQPooPQpo....",
    "....oPQpooPQpo....",
    "....opPpooPPpo....",
    "....oVWVooWVvo....",
    "...oVWWVooWWVvo...",
    "...ovVVvooVVvvo...",
    "....oooo..oooo....",
]

BACK = [
    "......o..o.o......",
    ".....o4oo4oo4o....",
    "...oo34434434443o.",
    "..o3343344344433o.",
    ".o23334433443432o.",
    "o2233343334433322o",
    ".o123332333343221o",
    "o1223321233332221o",
    "o1223212223322121o",
    ".o12332123332321o.",
    "o1223321233322321o",
    "o1232232123322321o",
    ".o12322322232321o.",
    ".o11232122321211o.",
    "..o112212122121o..",
    "...o1abbbbbba1o...",
    "...onBBBnnBBBno...",
    "..oBCBBBnnBBBCBo..",
    ".oBCCBBBBnBBBCBno.",
    ".oCBoBBBBnBBBoBno.",
    ".oCBoBBBBnBBBonno.",
    ".ocboBBBBnBBnobao.",
    ".ocboBBBBnBBnobao.",
    ".obaokLLLLLLkobao.",
    ".ocboPPPPPPPpocbo.",
    "..ooooPQPpPQpooo..",
    "....oPQPooPQpo....",
    "....oPQPooPQpo....",
    "....oPQpooPQpo....",
    "....opPpooPPpo....",
    "....oVVvooVVvo....",
    "....ovVvoovVvo....",
    "....ovvvoovvvo....",
    "....oooo..oooo....",
]

SIDE = [
    ".......o..o.......",
    ".....oo4oo4oo.....",
    "...oo334434444o...",
    "..o2333443344444o.",
    ".o223334333443443o",
    "o2233333433344332o",
    "o122333233334322o.",
    "o122332123332c22o.",
    "o1223212232cc1co..",
    "o122321223ccc1cco.",
    ".o12321bb2cccewco.",
    ".o1232baab2cccecco",
    ".o12321bb2bcccecbo",
    "..o1221122bccccco.",
    "...o11221abccmco..",
    "....oo11oabbbco...",
    ".....onBBBaRo.....",
    "....onBBCCBRRo....",
    "....oBBCDDCBro....",
    "....onBCDDCBBo....",
    "....onBBCCBBBo....",
    "....onBocboBno....",
    "....onBocboBno....",
    "....okLobaoLko....",
    "....oPPocboPpo....",
    "....oPPPooPPpo....",
    ".....oPQPPPpo.....",
    ".....oPQPpPpo.....",
    ".....oPQPopPo.....",
    ".....opPPoPpo.....",
    ".....oVWVoWVo.....",
    ".....oVWWVWWVVo...",
    ".....ovVVvVVVvvo..",
    "......ooooooooo...",
]

# --- Side torso (rows 16..24) without the near arm; walk and action frames draw the arm as its own layer ---
SIDE_TORSO = [
    ".....onBBBaRo.....",
    "....onBBCBBRRo....",
    "....oBBCBBBBro....",
    "....onBBBBBBBo....",
    "....onBBBBBBBo....",
    "....onBBBBBBno....",
    "....onBBBBBBno....",
    "....okLLLLLLyo....",
    "....oPPPPPPPpo....",
]

# --- Feminine keeper: head and collar redrawn from the poster's women; arms, belt, legs and boots are shared, ---
# --- so every walk and tool pose lines up exactly with the masculine keeper. ---
FRONT_F_HEAD = [  # high ponytail tied on the right, hanging down that side; lashes over larger eyes
    "...........oooo...",
    "......oooooo4554o.",
    "....oo3344431o453o",
    "...o3344444431o43o",
    "..o23344444343o43o",
    ".o223344433443o32o",
    "o12233343334433o2o",
    "o1223332333432221o",
    "o1223212333322121o",
    "o1232c12222c12321o",
    "o12coooccccoooc21o",
    "o12ceewcccceewc21o",
    "o12beeecccceeeb21o",
    ".o1bceecccceecb21o",
    ".o1oacbccmmccbo21o",
    "..o.oabbccccbao1o.",
]
FRONT_F_COLLAR = [  # open V collar instead of the neckerchief (rows 16..19, arm tops included)
    "...onBBoccoBBno...",
    "..oDCBDEbbEDBCBo..",
    ".oDECCBDCbCDCCBno.",
    ".oDCoCDCBBBCBoBno.",
]
FRONT_F = FRONT_F_HEAD + FRONT_F_COLLAR + FRONT[20:]
BACK_F = [r[::-1] for r in FRONT_F_HEAD[:9]] + [  # the ponytail falls on the left when seen from behind
    "o1232332123332321o",
    "o1223321233322321o",
    "o1232232123322321o",
    "o1232232223232321o",
    "o121232122321211o.",
    "o1o112212122121o..",
    ".o.o1abbbbbba1o...",
] + BACK[16:]
SIDE_F = [  # ponytail strand hangs down the back of the head
    "..ooo.............",
    ".o455o.ooooooo....",
    ".o453oo3344444oo..",
    "..o4o23443344444o.",
    ".o43o334333443443o",
    "o43o3333433344332o",
    "o43o333233334322o.",
    "o43o332123332c22o.",
    "o43o3212232cc1co..",
    "o43o321223cccooco.",
    "o43o321bb2cccewco.",
    "o43o32baab2cccecco",
    "o43o321bb2bcccecbo",
    "o43o221122bccccco.",
    "o43o11221abccmco..",
    ".oo.oo11oabbbco...",
    ".....onBBBaco.....",
    "....onBBCCBEbo....",
    "....oBBCDDCBEo....",
] + SIDE[19:]
SIDE_TORSO_F = [
    ".....onBBBaco.....",
    "....onBBCBBEbo....",
    "....oBBCBBBBEo....",
] + SIDE_TORSO[3:]


class Body:
    """
    One keeper body: its three standing masters (front = south, back = north, side = east; west is east mirrored)
    and the side torso the side poses draw under the near arm. `name` is the Appearance `body` id.
    Bodies share limb geometry, so every pose in walk.py, actions.py and poses.py works for any body.
    """

    def __init__(self, name, front, back, side, side_torso):
        """Store the masters after checking that every row is 18 cells and every master is 34 rows tall."""
        for label, rows, height in (('front', front, 34), ('back', back, 34), ('side', side, 34), ('side torso', side_torso, 9)):
            if len(rows) != height or any(len(r) != 18 for r in rows):
                raise ValueError(f'{name} {label} master must be {height} rows of 18 cells')
        self.name, self.front, self.back, self.side, self.side_torso = name, front, back, side, side_torso

    def master(self, facing):
        """The 18x34 master for one facing ('south', 'north', 'west', 'east'); west is east mirrored."""
        if facing == 'west':
            return [r[::-1] for r in self.side]
        return {'south': self.front, 'north': self.back, 'east': self.side}[facing]


BODIES = {
    'original': Body('original', FRONT, BACK, SIDE, SIDE_TORSO),
    'feminine': Body('feminine', FRONT_F, BACK_F, SIDE_F, SIDE_TORSO_F),
}
